/**
 * Ekran karti (NVENC) tespiti. Worker baslarken bir kez kisa bir deneme kodlamasi yapar; basarili
 * olursa tum video kodlamalari h264_nvenc ile yapilir, olmazsa libx264 (islemci) kullanilir.
 * .env: VIDEO_ENCODER=auto | nvenc | x264
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { type VideoEncoder, setVideoEncoder } from "./render";

export function nvencWorks(ffmpeg: string): boolean {
  const r = spawnSync(
    ffmpeg,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=1280x720:r=30:d=1",
      "-c:v",
      "h264_nvenc",
      "-preset",
      "p6",
      "-f",
      "null",
      "-",
    ],
    { timeout: 30_000, windowsHide: true },
  );
  return r.status === 0;
}

export function chooseEncoder(ffmpeg: string, setting = process.env.VIDEO_ENCODER): VideoEncoder {
  const want = (setting ?? "auto").trim().toLowerCase();
  const enc: VideoEncoder =
    want === "x264" ? "x264" : want === "nvenc" ? "nvenc" : nvencWorks(ffmpeg) ? "nvenc" : "x264";
  setVideoEncoder(enc);
  return enc;
}

/** Bir MP4'un hangi kodlayiciyla uretildigi (x264, dosya basina "x264 - core" imzasi yazar). */
export function fileEncoder(file: string): VideoEncoder {
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.alloc(4 * 1024 * 1024);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    return buf.subarray(0, n).includes("x264 - core") ? "x264" : "nvenc";
  } finally {
    fs.closeSync(fd);
  }
}
