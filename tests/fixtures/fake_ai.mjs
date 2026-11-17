// Testler icin sahte Stable Audio koprusu: her istek icin FFmpeg ile ton uretir.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
const args = process.argv.slice(2);
const req = JSON.parse(fs.readFileSync(args[args.indexOf("--batch") + 1], "utf8"));
if (process.env.FAKE_AI_FAIL) {
  console.log(JSON.stringify({ event: "error", error: "sahte hata: CUDA error" }));
  process.exit(1);
}
console.log(JSON.stringify({ event: "loaded", model: req.model, seconds: 0.1 }));
req.items.forEach((it, i) => {
  console.log(JSON.stringify({ event: "start", index: i, total: req.items.length }));
  execFileSync(process.env.FFMPEG_PATH || "ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=${220 + i * 55}:sample_rate=44100:duration=${it.duration}`,
    "-af",
    "volume=0.1",
    "-ac",
    "2",
    it.out,
  ]);
  console.log(
    JSON.stringify({ event: "done", index: i, total: req.items.length, seconds: 0.2, out: it.out }),
  );
});
console.log(JSON.stringify({ event: "finished", total: req.items.length }));
