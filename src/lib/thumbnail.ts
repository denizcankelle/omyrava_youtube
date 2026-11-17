import fs from "node:fs";
import path from "node:path";

export const THUMB_W = 1280;
export const THUMB_H = 720;
export const THUMB_MAX_BYTES = 2 * 1024 * 1024;

/** drawtext icin kalin bir yazi tipi (Windows, Linux, macOS). */
export function findFont(env: Record<string, string | undefined> = process.env): string | null {
  const winFonts = path.join(env.WINDIR ?? env.SystemRoot ?? "C:\\Windows", "Fonts");
  const candidates = [
    path.join(winFonts, "segoeuib.ttf"),
    path.join(winFonts, "arialbd.ttf"),
    path.join(winFonts, "calibrib.ttf"),
    path.join(winFonts, "arial.ttf"),
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    "/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

/** En fazla 2 satir, satir basina 28 karakter; fazlasi kesilir. */
export function normalizeThumbText(text: string): string[] {
  return text
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 2)
    .map((l) => (l.length > 28 ? `${l.slice(0, 27)}…` : l));
}

export function thumbFontSize(lines: string[]): number {
  const longest = Math.max(1, ...lines.map((l) => l.length));
  return Math.max(48, Math.min(120, Math.floor(1150 / (longest * 0.58))));
}

/**
 * Kapak komutu. Yazi tipi ve satirlar, Windows yol kacisi sorunlarindan kacinmak icin calisma
 * klasorune `font.ttf`, `line1.txt`, `line2.txt` olarak yazilir ve goreli adla verilir.
 * Her satir ayri ortalanir; altta yari saydam bir bant okunabilirligi artirir.
 */
export function thumbnailArgs(input: {
  source: string;
  isVideo: boolean;
  output: string;
  lineCount: number;
  fontSize: number;
  quality: number;
  /** 0: altta bant, ortali; 1: sol ustte, kenar karartma; 2: ortada buyuk, hafif karartma. */
  variant?: number;
}): string[] {
  const filters = [
    `scale=${THUMB_W}:${THUMB_H}:force_original_aspect_ratio=increase:flags=lanczos`,
    `crop=${THUMB_W}:${THUMB_H}`,
    "setsar=1",
  ];
  const n = Math.min(2, Math.max(0, input.lineCount));
  const variant = input.variant ?? 0;
  if (n > 0 && variant === 1) {
    const fs = Math.round(input.fontSize * 0.8);
    filters.push("vignette=angle=PI/3.5");
    for (let i = 0; i < n; i++)
      filters.push(
        `drawtext=fontfile=font.ttf:textfile=line${i + 1}.txt:fontcolor=white:fontsize=${fs}` +
          `:x=70:y=${70 + i * Math.round(fs * 1.2)}:shadowcolor=black@0.8:shadowx=4:shadowy=4`,
      );
  } else if (n > 0 && variant === 2) {
    const fs = Math.round(input.fontSize * 1.1);
    const total = n * fs + (n - 1) * Math.round(fs * 0.25);
    filters.push(`drawbox=x=0:y=0:w=iw:h=ih:color=black@0.25:t=fill`);
    for (let i = 0; i < n; i++)
      filters.push(
        `drawtext=fontfile=font.ttf:textfile=line${i + 1}.txt:fontcolor=white:fontsize=${fs}` +
          `:x=(w-text_w)/2:y=${Math.round((THUMB_H - total) / 2 + i * fs * 1.25)}` +
          `:shadowcolor=black@0.7:shadowx=5:shadowy=5`,
      );
  } else if (n > 0) {
    const fs = input.fontSize;
    const gap = Math.round(fs * 0.25);
    const bottom = 60;
    const bandTop = THUMB_H - bottom - n * fs - (n - 1) * gap - 50;
    filters.push(`drawbox=x=0:y=${bandTop}:w=iw:h=ih-${bandTop}:color=black@0.4:t=fill`);
    for (let i = 0; i < n; i++) {
      const y = THUMB_H - bottom - (n - i) * fs - (n - 1 - i) * gap;
      filters.push(
        `drawtext=fontfile=font.ttf:textfile=line${i + 1}.txt:fontcolor=white:fontsize=${fs}` +
          `:x=(w-text_w)/2:y=${y}:shadowcolor=black@0.7:shadowx=4:shadowy=4`,
      );
    }
  }
  return [
    "-y",
    ...(input.isVideo ? ["-ss", "1"] : []),
    "-i",
    input.source,
    "-frames:v",
    "1",
    "-vf",
    filters.join(","),
    "-q:v",
    String(input.quality),
    input.output,
  ];
}
