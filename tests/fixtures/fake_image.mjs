// Testler icin sahte FLUX koprusu: her istek icin FFmpeg ile 3840x2160 renkli kare uretir.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
const args = process.argv.slice(2);
const req = JSON.parse(fs.readFileSync(args[args.indexOf("--batch") + 1], "utf8"));
if (process.env.FAKE_IMAGE_FAIL) {
  console.log(JSON.stringify({ event: "error", error: "sahte hata: CUDA out of memory" }));
  process.exit(1);
}
console.log(JSON.stringify({ event: "encoded", count: req.items.length, seconds: 0.1 }));
console.log(JSON.stringify({ event: "loaded", model: "flux-schnell", seconds: 0.1 }));
req.items.forEach((it, i) => {
  execFileSync(process.env.FFMPEG_PATH || "ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "gradients=s=960x540:c0=0x102030:c1=0x405070:nb_colors=2:d=1,scale=3840:2160",
    "-frames:v",
    "1",
    it.out,
  ]);
  console.log(
    JSON.stringify({ event: "generated", index: i, total: req.items.length, seconds: 0.2 }),
  );
  console.log(
    JSON.stringify({ event: "done", index: i, total: req.items.length, out: it.out, seconds: 0.1 }),
  );
});
