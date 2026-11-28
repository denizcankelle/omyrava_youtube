/**
 * Video arka plani gorsel paketi: her tur grubu icin yapay zeka (FLUX) ile yazisiz 4K sahneler
 * uretir ve 2K kopyasini cikarir. Cikti: gorseller\<grup>\<sahne>-<n>-4k.png ve -2k.jpg
 * Calistirma: GORSEL-PAKET.bat (once GORSEL-KUR.bat ile kurulum gerekli).
 * Var olan gorseller atlanir; yarida kalirsa tekrar calistirmak kaldigi yerden devam eder.
 */
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { getConfig } from "../src/lib/config";
import { COVER_MAX_BYTES, cleanCoverArgs } from "../src/lib/cover";
import { resolveFfmpegPath } from "../src/lib/ffmpeg";
import { SCENES, type SceneId } from "../src/lib/scene";

const STYLE =
  "cinematic photograph, ultra detailed, soft natural light, calm and peaceful mood, " +
  "high dynamic range, 4k wallpaper, no people, no text";

export const GROUPS: Record<string, SceneId[]> = {
  "uyku (deep sleep, rain, ocean)": [
    "milky_way",
    "misty_lake",
    "fjord_aurora",
    "rain_room",
    "rain_cabin",
    "ocean_moon",
    "ocean_dusk",
  ],
  "piyano (kece, romantik)": ["rain_room", "rain_cabin", "misty_lake", "snow_forest"],
  "nordic viking": ["viking_fire", "rune_forest", "fjord_aurora", "snow_forest"],
  "dark blues ve lofi": ["blues_bar", "desert_road", "rain_city_night", "lofi_desk"],
};

/** Her sahnenin her istemi icin bir gorsel (sahne birden fazla grupta olsa da bir kez uretilir). */
export function packItems(outRoot: string) {
  const scenes = [...new Set(Object.values(GROUPS).flat())];
  const items: { scene: SceneId; n: number; prompt: string; seed: number; out: string }[] = [];
  scenes.forEach((scene, si) => {
    SCENES[scene].prompts.forEach((p, n) => {
      items.push({
        scene,
        n: n + 1,
        prompt: `${p}. ${STYLE}`,
        seed: 4000 + si * 37 + n * 11,
        out: path.join(outRoot, "_kaynak", `${scene}-${n + 1}-4k.png`),
      });
    });
  });
  return items;
}

async function main() {
  const cfg = getConfig();
  const root = path.resolve(__dirname, "..");
  const outRoot = path.join(root, "gorseller");
  const python = cfg.imagePython;
  if (!fs.existsSync(python)) {
    console.log("HATA: Gorsel yapay zekasi kurulu degil. Once GORSEL-KUR.bat'i calistir.");
    process.exit(1);
  }
  const ffmpeg = resolveFfmpegPath(cfg.ffmpegPath);
  const all = packItems(outRoot);
  const todo = all.filter((i) => !fs.existsSync(i.out));
  console.log(`Toplam ${all.length} sahne gorseli; uretilecek: ${todo.length}`);
  if (todo.length) {
    fs.mkdirSync(path.join(outRoot, "_kaynak"), { recursive: true });
    const req = path.join(outRoot, "_kaynak", "istek.json");
    fs.writeFileSync(
      req,
      JSON.stringify({ items: todo.map((i) => ({ prompt: i.prompt, seed: i.seed, out: i.out })) }),
    );
    await new Promise<void>((resolve, reject) => {
      const child = spawn(python, [path.join(cfg.aiDir, "omyrava_image.py"), "--batch", req], {
        windowsHide: true,
        env: {
          ...process.env,
          HF_HOME: process.env.HF_HOME || path.join(cfg.aiDir, "hf-cache"),
          PYTHONIOENCODING: "utf-8",
          PYTHONUTF8: "1",
        },
      });
      let buf = "";
      child.stdout.on("data", (c: Buffer) => {
        buf += c.toString();
        const lines = buf.split(/\r?\n/);
        buf = lines.pop() ?? "";
        for (const l of lines) {
          if (!l.startsWith("{")) continue;
          try {
            const e = JSON.parse(l) as {
              event: string;
              index?: number;
              total?: number;
              seconds?: number;
              error?: string;
            };
            if (e.event === "loaded") console.log("Model yuklendi, gorseller uretiliyor...");
            if (e.event === "generated")
              console.log(`  [${e.index! + 1}/${e.total}] uretildi (${e.seconds} sn)`);
            if (e.event === "done")
              console.log(`  [${e.index! + 1}/${e.total}] 4K'ya buyutuldu (${e.seconds} sn)`);
            if (e.event === "error") console.log(`  HATA: ${e.error}`);
          } catch {
            /* yoksay */
          }
        }
      });
      child.stderr.on("data", (c: Buffer) => {
        const s = c.toString();
        if (/error|Error|CUDA/.test(s)) process.stdout.write(s);
      });
      child.on("error", reject);
      child.on("close", (code) =>
        code === 0 ? resolve() : reject(new Error(`Python cikis kodu ${code}`)),
      );
    });
    fs.rmSync(req, { force: true });
  }
  // Gruplara dagit: 4K PNG + 2K JPG
  let made = 0;
  for (const [group, scenes] of Object.entries(GROUPS)) {
    const dir = path.join(outRoot, group);
    fs.mkdirSync(dir, { recursive: true });
    for (const it of all.filter((i) => scenes.includes(i.scene))) {
      if (!fs.existsSync(it.out)) continue;
      const name = `${it.scene}-${it.n}`;
      const k4 = path.join(dir, `${name}-4k.png`);
      const k2 = path.join(dir, `${name}-2k.jpg`);
      if (!fs.existsSync(k4)) fs.copyFileSync(it.out, k4);
      if (!fs.existsSync(k2)) {
        // 2 MB altinda: YouTube kapagi olarak da yuklenebilsin
        for (const args of cleanCoverArgs(it.out, k2)) {
          execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", ...args]);
          if (fs.statSync(k2).size <= COVER_MAX_BYTES) break;
        }
        made++;
      }
    }
  }
  for (const f of fs.readdirSync(path.join(outRoot, "_kaynak")))
    if (f.endsWith("-ham.png")) fs.rmSync(path.join(outRoot, "_kaynak", f), { force: true });
  console.log(`Bitti. Klasor: ${outRoot} (${made} yeni 2K kopya)`);
}

if (require.main === module || process.argv[1]?.includes("gorsel-paketi"))
  main().catch((e) => {
    console.log(`HATA: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  });
