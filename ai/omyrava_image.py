"""
Omyrava Studio - yerel yapay zeka GORSEL koprusu (FLUX.1-schnell + Real-ESRGAN x2).

FLUX.1-schnell: Apache-2.0 (ticari kullanim serbest). Donusturucu GGUF Q6_K (city96, Apache-2.0).
Real-ESRGAN x2plus: BSD-3-Clause.

16 GB ekran kartinda calisacak sekilde iki asamali:
  1) Metin kodlayicilar (CLIP + T5) GPU'ya yuklenir, tum istemler kodlanir, bellekten atilir.
  2) GGUF donusturucu + VAE yuklenir, 1920x1088 gorseller uretilir.
  3) Real-ESRGAN x2 ile 3840x2176'ya buyutulur, ortadan 3840x2160 kirpilir (4K).

Kullanim:
  python omyrava_image.py --check
  python omyrava_image.py --setup-test          # indirir, 1 deneme gorseli uretir, gorsel-durum.json yazar
  python omyrava_image.py --batch istek.json    # toplu uretim

istek.json:
  {"items": [{"prompt": "...", "seed": 123, "out": "C:/.../sahne.png", "upscale": true}]}

Her adimda stdout'a tek satir JSON yazar: {"event": "...", ...}

Test/gelistirme icin ortam degiskenleri:
  OMYRAVA_FLUX_REPO  (vars. black-forest-labs/FLUX.1-schnell)
  OMYRAVA_FLUX_GGUF  (vars. city96/FLUX.1-schnell-gguf:flux1-schnell-Q6_K.gguf; "none" = repodaki donusturucu)
  OMYRAVA_DEVICE     (vars. cuda)
  OMYRAVA_GEN_SIZE   (vars. 1920x1088)
"""

import argparse
import gc
import json
import os
import sys
import time
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
STATUS_FILE = os.path.join(HERE, "gorsel-durum.json")
MODELS_DIR = os.path.join(HERE, "models")
ESRGAN_FILE = os.path.join(MODELS_DIR, "RealESRGAN_x2plus.pth")
ESRGAN_URL = "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.1/RealESRGAN_x2plus.pth"

FLUX_REPO = os.environ.get("OMYRAVA_FLUX_REPO", "black-forest-labs/FLUX.1-schnell")
FLUX_GGUF = os.environ.get("OMYRAVA_FLUX_GGUF", "city96/FLUX.1-schnell-gguf:flux1-schnell-Q6_K.gguf")
DEVICE = os.environ.get("OMYRAVA_DEVICE", "cuda")
GEN_W, GEN_H = (int(x) for x in os.environ.get("OMYRAVA_GEN_SIZE", "1920x1088").split("x"))
OUT_W, OUT_H = 3840, 2160


def emit(**kw):
    print(json.dumps(kw, ensure_ascii=False), flush=True)


def token():
    return os.environ.get("HF_TOKEN") or None


def check():
    info = {"python": sys.version.split()[0]}
    try:
        import torch

        info["torch"] = torch.__version__
        info["cuda"] = torch.cuda.is_available()
        if info["cuda"]:
            info["gpu"] = torch.cuda.get_device_name(0)
            info["vram_gb"] = round(torch.cuda.get_device_properties(0).total_memory / 1024**3, 1)
    except Exception as e:  # noqa: BLE001
        info["torch_error"] = repr(e)
    for mod in ("diffusers", "transformers", "gguf", "spandrel"):
        try:
            m = __import__(mod)
            info[mod] = getattr(m, "__version__", "ok")
        except Exception as e:  # noqa: BLE001
            info[mod] = None
            info[f"{mod}_error"] = repr(e)[:300]
    info["hf_token"] = bool(token())
    return info


# ---------------------------------------------------------------- indirme


def base_dir():
    """FLUX reposundan yalnizca gereken parcalar (23 GB'lik tek dosya indirilmez)."""
    from huggingface_hub import snapshot_download

    if os.path.isdir(FLUX_REPO):
        return FLUX_REPO
    allow = [
        "model_index.json",
        "scheduler/*",
        "text_encoder/*",
        "text_encoder_2/*",
        "tokenizer/*",
        "tokenizer_2/*",
        "vae/*",
        "transformer/config.json",
    ]
    if FLUX_GGUF == "none":
        allow.append("transformer/*")
    return snapshot_download(FLUX_REPO, allow_patterns=allow, token=token())


def gguf_file():
    from huggingface_hub import hf_hub_download

    if FLUX_GGUF == "none":
        return None
    if os.path.isfile(FLUX_GGUF):
        return FLUX_GGUF
    repo, name = FLUX_GGUF.split(":", 1)
    try:
        return hf_hub_download(repo, name, token=token())
    except Exception:  # noqa: BLE001
        # Dosya adi degismisse ayni nicemleme seviyesini (or. Q6_K) repoda ara
        from huggingface_hub import HfApi

        level = name.rsplit("-", 1)[-1].replace(".gguf", "")
        files = [f for f in HfApi().list_repo_files(repo, token=token()) if f.endswith(f"{level}.gguf")]
        if not files:
            raise
        return hf_hub_download(repo, files[0], token=token())


def esrgan_file():
    if os.path.isfile(ESRGAN_FILE):
        return ESRGAN_FILE
    import urllib.request

    os.makedirs(MODELS_DIR, exist_ok=True)
    tmp = ESRGAN_FILE + ".part"
    urllib.request.urlretrieve(ESRGAN_URL, tmp)
    os.replace(tmp, ESRGAN_FILE)
    return ESRGAN_FILE


# ---------------------------------------------------------------- uretim


def dtype():
    import torch

    return torch.bfloat16 if DEVICE == "cuda" else torch.float32


def encode_prompts(base, prompts):
    """Asama 1: istemleri kodla, metin kodlayicilari bellekten at."""
    import torch
    from diffusers import FluxPipeline

    t = time.time()
    pipe = FluxPipeline.from_pretrained(base, transformer=None, vae=None, dtype=dtype())
    pipe.to(DEVICE)
    out = []
    with torch.no_grad():
        for p in prompts:
            pe, ppe, _ = pipe.encode_prompt(prompt=p, prompt_2=None, max_sequence_length=256)
            out.append((pe.to("cpu"), ppe.to("cpu")))
    del pipe
    free()
    emit(event="encoded", count=len(prompts), seconds=round(time.time() - t, 1))
    return out


def load_generator(base):
    """Asama 2: GGUF donusturucu + VAE (metin kodlayicilar olmadan)."""
    from diffusers import FluxPipeline, FluxTransformer2DModel, GGUFQuantizationConfig

    t = time.time()
    gf = gguf_file()
    kw = {}
    if gf:
        kw["transformer"] = FluxTransformer2DModel.from_single_file(
            gf,
            quantization_config=GGUFQuantizationConfig(compute_dtype=dtype()),
            config=base,
            subfolder="transformer",
            dtype=dtype(),
        )
    pipe = FluxPipeline.from_pretrained(
        base,
        text_encoder=None,
        text_encoder_2=None,
        tokenizer=None,
        tokenizer_2=None,
        dtype=dtype(),
        **kw,
    )
    pipe.to(DEVICE)
    pipe.vae.enable_tiling()
    emit(event="loaded", model="flux-schnell", seconds=round(time.time() - t, 1))
    return pipe


def free():
    gc.collect()
    try:
        import torch

        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:  # noqa: BLE001
        pass


def generate(pipe, emb, seed, steps=4):
    import torch

    pe, ppe = emb
    g = torch.Generator("cpu").manual_seed(int(seed))
    with torch.no_grad():
        img = pipe(
            prompt_embeds=pe.to(DEVICE),
            pooled_prompt_embeds=ppe.to(DEVICE),
            num_inference_steps=steps,
            guidance_scale=0.0,
            width=GEN_W,
            height=GEN_H,
            generator=g,
        ).images[0]
    return img


def load_upscaler():
    import spandrel
    import torch

    model = spandrel.ModelLoader().load_from_file(esrgan_file())
    model = model.eval().to(DEVICE)
    if DEVICE == "cuda":
        model = model.half()
    emit(event="upscaler", scale=model.scale, arch=str(model.architecture.name))
    return model, torch


def upscale(model_torch, img, tile=512, pad=48):
    """Parcali (tile) x2 buyutme; parca sinirlarinda dikis olmamasi icin kenar payi."""
    import numpy as np

    model, torch = model_torch
    s = model.scale
    arr = np.asarray(img.convert("RGB"), dtype=np.float32) / 255.0
    h, w, _ = arr.shape
    x = torch.from_numpy(arr).permute(2, 0, 1).unsqueeze(0)
    out = torch.zeros((1, 3, h * s, w * s), dtype=torch.float32)
    half = DEVICE == "cuda"
    with torch.no_grad():
        for y0 in range(0, h, tile):
            for x0 in range(0, w, tile):
                y1, x1 = min(y0 + tile, h), min(x0 + tile, w)
                ya, xa = max(y0 - pad, 0), max(x0 - pad, 0)
                yb, xb = min(y1 + pad, h), min(x1 + pad, w)
                part = x[:, :, ya:yb, xa:xb].to(DEVICE)
                if half:
                    part = part.half()
                r = model(part).float().cpu()
                out[:, :, y0 * s : y1 * s, x0 * s : x1 * s] = r[
                    :, :, (y0 - ya) * s : (y0 - ya + y1 - y0) * s, (x0 - xa) * s : (x0 - xa + x1 - x0) * s
                ]
    res = (out.clamp(0, 1)[0].permute(1, 2, 0).numpy() * 255.0 + 0.5).astype("uint8")
    from PIL import Image

    return Image.fromarray(res)


def to_4k(img):
    """Ortadan kirp + tam 3840x2160."""
    from PIL import Image

    w, h = img.size
    target = OUT_W / OUT_H
    if abs(w / h - target) > 1e-3:
        if w / h > target:
            nw = round(h * target)
            img = img.crop(((w - nw) // 2, 0, (w - nw) // 2 + nw, h))
        else:
            nh = round(w / target)
            img = img.crop((0, (h - nh) // 2, w, (h - nh) // 2 + nh))
    if img.size != (OUT_W, OUT_H):
        img = img.resize((OUT_W, OUT_H), Image.LANCZOS)
    return img


def run_batch(req):
    items = req["items"]
    base = base_dir()
    embs = encode_prompts(base, [it["prompt"] for it in items])
    pipe = load_generator(base)
    raws = []
    for i, it in enumerate(items):
        emit(event="start", index=i, total=len(items), stage="generate")
        t = time.time()
        img = generate(pipe, embs[i], it.get("seed", 0), int(it.get("steps", 4)))
        raw = os.path.splitext(it["out"])[0] + "-ham.png"
        os.makedirs(os.path.dirname(os.path.abspath(raw)), exist_ok=True)
        img.save(raw)
        raws.append(raw)
        emit(event="generated", index=i, total=len(items), seconds=round(time.time() - t, 1))
    del pipe
    free()
    up = None
    from PIL import Image

    for i, it in enumerate(items):
        img = Image.open(raws[i])
        t = time.time()
        if it.get("upscale", True):
            if up is None:
                up = load_upscaler()
            img = upscale(up, img)
        to_4k(img).save(it["out"])
        emit(event="done", index=i, total=len(items), out=it["out"], seconds=round(time.time() - t, 1))


def setup_test():
    info = check()
    emit(event="check", **info)
    status = {"ready": False, "checked_at": time.strftime("%Y-%m-%d %H:%M:%S"), "check": info}
    try:
        if DEVICE == "cuda" and not info.get("cuda"):
            raise RuntimeError("CUDA (NVIDIA GPU) PyTorch tarafından görülmüyor.")
        if not info.get("hf_token") and not os.path.isdir(FLUX_REPO):
            raise RuntimeError("HF_TOKEN yok. .env dosyasına Hugging Face erişim anahtarını yaz.")
        emit(event="download", what="Real-ESRGAN x2")
        esrgan_file()
        emit(event="download", what="FLUX.1-schnell parçaları (~20 GB, ilk seferde)")
        base_dir()
        gguf_file()
        out = os.path.join(HERE, "test-gorsel.png")
        t = time.time()
        run_batch(
            {
                "items": [
                    {
                        "prompt": "A cozy wooden cabin by a calm misty lake at night, snowy pine forest, "
                        "warm light in the window, soft moonlight, cinematic, highly detailed, 4k",
                        "seed": 42,
                        "out": out,
                    }
                ]
            }
        )
        status.update(
            ready=True,
            model="flux-schnell",
            gguf=FLUX_GGUF,
            upscaler="RealESRGAN_x2plus",
            test_file=out,
            test_seconds=round(time.time() - t, 1),
        )
        emit(event="test_ok", seconds=status["test_seconds"])
    except Exception as e:  # noqa: BLE001
        msg = repr(e)
        if "401" in msg or "403" in msg or "gated" in msg.lower() or "access" in msg.lower():
            msg += (
                " | Hugging Face'te black-forest-labs/FLUX.1-schnell sayfasında lisansı kabul "
                "ettiğinden ve HF_TOKEN'ın doğru olduğundan emin ol."
            )
        status["error"] = msg[:1500]
        status["trace"] = traceback.format_exc()[-3000:]
        emit(event="error", error=status["error"])
    with open(STATUS_FILE, "w", encoding="utf-8") as f:
        json.dump(status, f, ensure_ascii=False, indent=2)
    return 0 if status["ready"] else 1


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--setup-test", action="store_true")
    ap.add_argument("--batch")
    a = ap.parse_args()
    if a.check:
        emit(event="check", **check())
        return 0
    if a.setup_test:
        return setup_test()
    if a.batch:
        try:
            with open(a.batch, encoding="utf-8") as f:
                run_batch(json.load(f))
            return 0
        except Exception as e:  # noqa: BLE001
            emit(event="error", error=repr(e)[:1500], trace=traceback.format_exc()[-2000:])
            return 1
    ap.print_help()
    return 2


if __name__ == "__main__":
    sys.exit(main())
