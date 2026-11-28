/**
 * Yazisiz kapak: sahne karesinden 2560x1440 JPG. YouTube kapak siniri 2 MB oldugu icin
 * kalite adim adim dusurulerek denenir (ilk sigan kullanilir).
 */
export const COVER_MAX_BYTES = 2 * 1024 * 1024;
export const COVER_W = 2560;
export const COVER_H = 1440;

export function cleanCoverArgs(input: string, out: string): string[][] {
  return [2, 4, 6, 9, 13].map((q) => [
    "-y",
    "-i",
    input,
    "-vf",
    `scale=${COVER_W}:${COVER_H}:force_original_aspect_ratio=increase:flags=lanczos,crop=${COVER_W}:${COVER_H}`,
    "-frames:v",
    "1",
    "-q:v",
    String(q),
    "-pix_fmt",
    "yuvj420p",
    out,
  ]);
}
