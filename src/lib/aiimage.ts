/** Yerel yapay zeka gorsel (FLUX.1-schnell) kurulum durumu. */
import fs from "node:fs";
import path from "node:path";

export interface ImageAiStatus {
  ready: boolean;
  model?: string;
  error?: string;
  checked_at?: string;
}

export function readImageStatus(aiDir: string): ImageAiStatus | null {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(aiDir, "gorsel-durum.json"), "utf8"),
    ) as ImageAiStatus;
  } catch {
    return null;
  }
}

export function isImageAiReady(aiDir: string, python: string): boolean {
  const s = readImageStatus(aiDir);
  return Boolean(s?.ready && fs.existsSync(python));
}

export const IMAGE_LICENSE = {
  provider: "FLUX.1-schnell (Black Forest Labs) — yerel yapay zekâ; Real-ESRGAN ile 4K",
  licenseType: "Apache-2.0 (FLUX.1-schnell), BSD-3 (Real-ESRGAN); yapay zekâ ile üretildi",
};
