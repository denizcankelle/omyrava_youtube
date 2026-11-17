"""
Omyrava Studio - yerel yapay zeka muzik koprusu (Stable Audio 3).

Kullanim:
  python omyrava_ai.py --check                 # GPU / Flash Attention / kutuphane kontrolu
  python omyrava_ai.py --setup-test            # modeli indirir, 10 sn deneme uretir, ai-durum.json yazar
  python omyrava_ai.py --batch istek.json      # toplu uretim

istek.json:
  {"model": "medium", "items": [{"prompt": "...", "negative": "...", "duration": 300,
                                 "seed": 123, "out": "C:/.../seg1.wav"}]}

Her adimda stdout'a tek satir JSON yazar: {"event": "...", ...}
"""

import argparse
import json
import os
import sys
import time
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
STATUS_FILE = os.path.join(HERE, "ai-durum.json")


def emit(**kw):
    print(json.dumps(kw, ensure_ascii=False), flush=True)


def check():
    info = {"python": sys.version.split()[0]}
    try:
        import torch

        info["torch"] = torch.__version__
        info["cuda"] = torch.cuda.is_available()
        if info["cuda"]:
            info["gpu"] = torch.cuda.get_device_name(0)
            info["vram_gb"] = round(torch.cuda.get_device_properties(0).total_memory / 1024**3, 1)
            info["capability"] = ".".join(map(str, torch.cuda.get_device_capability(0)))
            info["arch_list"] = torch.cuda.get_arch_list()
    except Exception as e:  # noqa: BLE001
        info["torch_error"] = repr(e)
    try:
        import flash_attn  # noqa: F401

        info["flash_attn"] = getattr(flash_attn, "__version__", "ok")
    except Exception as e:  # noqa: BLE001
        info["flash_attn"] = None
        info["flash_attn_error"] = repr(e)[:300]
    try:
        import stable_audio_3  # noqa: F401

        info["stable_audio_3"] = True
    except Exception as e:  # noqa: BLE001
        info["stable_audio_3"] = False
        info["stable_audio_3_error"] = repr(e)[:300]
    info["hf_token"] = bool(os.environ.get("HF_TOKEN"))
    return info


def save_wav(audio, sample_rate, path):
    import soundfile as sf

    data = audio[0].float().cpu().numpy().T
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    sf.write(path, data, sample_rate, subtype="PCM_24")


def load(model_name):
    from stable_audio_3 import StableAudioModel

    t = time.time()
    model = StableAudioModel.from_pretrained(model_name, device="cuda")
    emit(event="loaded", model=model_name, seconds=round(time.time() - t, 1))
    return model


def generate(model, item):
    t = time.time()
    audio = model.generate(
        prompt=item["prompt"],
        negative_prompt=item.get("negative") or None,
        duration=float(item["duration"]),
        seed=int(item.get("seed", -1)),
        steps=int(item.get("steps", 8)),
        cfg_scale=float(item.get("cfg_scale", 1.0)),
    )
    save_wav(audio, model.model.sample_rate, item["out"])
    return round(time.time() - t, 1)


def setup_test():
    info = check()
    emit(event="check", **info)
    status = {"ready": False, "checked_at": time.strftime("%Y-%m-%d %H:%M:%S"), "check": info}
    if not info.get("cuda"):
        status["error"] = "CUDA (NVIDIA GPU) PyTorch tarafından görülmüyor."
    elif not info.get("hf_token"):
        status["error"] = "HF_TOKEN yok. .env dosyasına Hugging Face erişim anahtarını yaz."
    else:
        order = ["medium", "small-music"] if info.get("flash_attn") else ["small-music"]
        for name in order:
            try:
                model = load(name)
                out = os.path.join(HERE, f"test-{name}.wav")
                secs = generate(
                    model,
                    {
                        "prompt": "TrackType: Music, VocalType: Instrumental. Slow calm solo piano, soft and warm, 60 BPM",
                        "negative": "drums, vocals, harsh, distorted",
                        "duration": 10,
                        "seed": 42,
                        "out": out,
                    },
                )
                status.update(ready=True, model=name, test_file=out, test_seconds=secs)
                emit(event="test_ok", model=name, seconds=secs)
                break
            except Exception as e:  # noqa: BLE001
                msg = repr(e)
                emit(event="test_failed", model=name, error=msg[:1000])
                status.setdefault("attempts", []).append({"model": name, "error": msg[:2000]})
                if "401" in msg or "403" in msg or "gated" in msg.lower() or "access" in msg.lower():
                    status["error"] = (
                        "Hugging Face erişimi reddedildi: model sayfalarında lisansı kabul ettiğinden "
                        "ve HF_TOKEN'ın doğru olduğundan emin ol."
                    )
                    break
        if not status["ready"] and "error" not in status:
            status["error"] = "Model yüklenemedi; ayrıntı attempts alanında."
    with open(STATUS_FILE, "w", encoding="utf-8") as f:
        json.dump(status, f, ensure_ascii=False, indent=2)
    emit(event="status", **status)
    return 0 if status["ready"] else 1


def batch(path):
    with open(path, encoding="utf-8") as f:
        req = json.load(f)
    model = load(req.get("model", "medium"))
    items = req["items"]
    for i, item in enumerate(items):
        emit(event="start", index=i, total=len(items))
        secs = generate(model, item)
        emit(event="done", index=i, total=len(items), seconds=secs, out=item["out"])
    emit(event="finished", total=len(items))
    return 0


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--check", action="store_true")
    p.add_argument("--setup-test", action="store_true")
    p.add_argument("--batch")
    a = p.parse_args()
    try:
        if a.check:
            emit(event="check", **check())
            return 0
        if a.setup_test:
            return setup_test()
        if a.batch:
            return batch(a.batch)
        p.print_help()
        return 2
    except Exception as e:  # noqa: BLE001
        emit(event="error", error=repr(e)[:2000], trace=traceback.format_exc()[-3000:])
        return 1


if __name__ == "__main__":
    sys.exit(main())
