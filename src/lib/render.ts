/**
 * Uzun video render plani. Strateji: kisa, kusursuz bir video dongusu ve ses dongusu bir kez
 * kodlanir; ses hedef sureye bir kez AAC'ye kodlanir; video `-stream_loop` + `-c copy` ile
 * yeniden kodlanmadan hedef sureye uzatilip sesle birlestirilir.
 */
import { z } from "zod";

export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;
export const AUDIO_BITRATE_K = 320;
export const PREVIEW_SECONDS = 120;

export const renderOptionsSchema = z.object({
  projectId: z.string().min(1),
  audioAssetId: z.string().min(1, "Ses dosyası seç"),
  visualAssetId: z.string().min(1, "Görsel veya video döngü seç"),
  mode: z.enum(["preview", "full"]),
  /** Gorsel icin: hareketsiz veya cok yavas kayma. */
  motion: z.enum(["none", "drift"]).default("drift"),
  /** Video dongu icin: sonu basa capraz gecisle bagla. */
  seamless: z
    .preprocess((v) => v === "on" || v === "true" || v === true, z.boolean())
    .default(true),
  /** Tam renderda: bu kadar dakika sonra goruntu yavasca kararir, ses devam eder (0 = kapali). */
  darkAfterMin: z.coerce.number().int().min(0).max(240).default(0),
});

export type RenderOptions = z.infer<typeof renderOptionsSchema>;

const n = (x: number) => x.toFixed(3);

/** Proje cozunurlugu -> piksel boyutu. */
export function dims(resolution: string | undefined | null): { w: number; h: number } {
  return resolution === "4k" ? { w: 3840, h: 2160 } : { w: WIDTH, h: HEIGHT };
}

/**
 * x264 ayarlari. B-kare yok ve sabit GOP: dongu sinirlarinda kopyalama sorunsuz olsun.
 * 4K'da tavan bit hizi yuksek ama sinirli: 10 saatlik video diski doldurmasin.
 */
export function x264For(height: number): string[] {
  const uhd = height >= 2000;
  return [
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    uhd ? "23" : "20",
    "-maxrate",
    uhd ? "14M" : "8M",
    "-bufsize",
    uhd ? "28M" : "16M",
    "-bf",
    "0",
    "-g",
    String(FPS * 2),
    "-keyint_min",
    String(FPS * 2),
    "-sc_threshold",
    "0",
    "-r",
    String(FPS),
    "-pix_fmt",
    "yuv420p",
    "-an",
    "-movflags",
    "+faststart",
  ];
}

const normalizeV = (w: number, h: number) =>
  `fps=${FPS},scale=${w}:${h}:force_original_aspect_ratio=increase:flags=lanczos,` +
  `crop=${w}:${h},setsar=1,format=yuv420p`;

/** Video dongu: 1080p30'a getirir; seamless ise son `d` saniyeyi basa capraz gecisle baglar. */
export function videoLoopFromVideoArgs(
  input: string,
  output: string,
  durationSec: number,
  seamless: boolean,
  w = WIDTH,
  h = HEIGHT,
): string[] {
  const X264 = x264For(h);
  if (!seamless) {
    return ["-y", "-i", input, "-t", n(durationSec), "-vf", normalizeV(w, h), ...X264, output];
  }
  const d = Math.min(1, durationSec / 4);
  const L = durationSec;
  const graph =
    `[0:v]${normalizeV(w, h)},split=3[a][b][c];` +
    `[a]trim=start=${n(L - d)}:end=${n(L)},setpts=PTS-STARTPTS[tail];` +
    `[b]trim=start=0:end=${n(d)},setpts=PTS-STARTPTS[head];` +
    `[tail][head]xfade=transition=fade:duration=${n(d)}:offset=0[x];` +
    `[c]trim=start=${n(d)}:end=${n(L - d)},setpts=PTS-STARTPTS[mid];` +
    `[x][mid]concat=n=2:v=1:a=0,format=yuv420p[v]`;
  return ["-y", "-i", input, "-filter_complex", graph, "-map", "[v]", ...X264, output];
}

/** Gorseli hedef boyuta getirir (kenarlar kirpilir). */
export function imagePrescaleArgs(input: string, output: string, w = WIDTH, h = HEIGHT): string[] {
  const vf = `scale=${w}:${h}:force_original_aspect_ratio=increase:flags=lanczos,crop=${w}:${h}`;
  return ["-y", "-i", input, "-vf", vf, "-frames:v", "1", output];
}

/**
 * Gorsel uzerinde periyot boyunca gidip gelen cok hafif yakinlasma (alt piksel, titremesiz).
 * Periyot sonunda basa doner: dongu kusursuzdur.
 */
export function breathingZoom(periodSec: number, zoom = 0.025): string {
  const k = `(${zoom}/2*(1-cos(2*PI*in/${periodSec * FPS})))`;
  return (
    `perspective=x0='W*${k}':y0='H*${k}':x1='W-W*${k}':y1='H*${k}':` +
    `x2='W*${k}':y2='H-H*${k}':x3='W-W*${k}':y3='H-H*${k}':interpolation=linear:eval=frame`
  );
}

/**
 * Gorselden dongu. 'drift': cok yavas nefes alan yakinlasma (60 sn). 'none': hareketsiz kisa dongu.
 */
export function videoLoopFromImageArgs(
  prescaled: string,
  output: string,
  motion: "none" | "drift",
  periodSec = 60,
  h = HEIGHT,
): string[] {
  const still = motion === "none";
  return [
    "-y",
    "-loop",
    "1",
    "-framerate",
    String(FPS),
    "-i",
    prescaled,
    "-t",
    String(still ? 10 : periodSec),
    "-vf",
    still
      ? "setsar=1,format=yuv420p"
      : `format=gbrp,${breathingZoom(periodSec)},setsar=1,format=yuv420p`,
    ...x264For(h),
    output,
  ];
}

/** Ses dongusu: son `d` saniye basla capraz karisir; tekrar edildiginde dikis duyulmaz. */
export function audioLoopArgs(input: string, output: string, durationSec: number): string[] {
  const L = durationSec;
  const d = Math.min(20, L / 4);
  const graph =
    `[0:a]aresample=48000,asplit=3[a][b][c];` +
    `[a]atrim=start=${n(L - d)}:end=${n(L)},asetpts=PTS-STARTPTS,afade=t=out:d=${n(d)}[tail];` +
    `[b]atrim=start=0:end=${n(d)},asetpts=PTS-STARTPTS,afade=t=in:d=${n(d)}[head];` +
    `[tail][head]amix=inputs=2:normalize=0[x];` +
    `[c]atrim=start=${n(d)}:end=${n(L - d)},asetpts=PTS-STARTPTS[mid];` +
    `[x][mid]concat=n=2:v=0:a=1[o]`;
  return ["-y", "-i", input, "-filter_complex", graph, "-map", "[o]", "-c:a", "flac", output];
}

/** Hedef sureli ses: dongu tekrarlanir, basta 5 sn / sonda 10 sn fade, bir kez AAC. */
export function fullAudioArgs(
  input: string,
  output: string,
  targetSec: number,
  loop: boolean,
): string[] {
  const fadeIn = Math.min(5, targetSec / 10);
  const fadeOut = Math.min(10, targetSec / 10);
  return [
    "-y",
    ...(loop ? ["-stream_loop", "-1"] : []),
    "-i",
    input,
    "-t",
    n(targetSec),
    "-vn",
    "-af",
    `aresample=48000,afade=t=in:d=${n(fadeIn)},afade=t=out:st=${n(targetSec - fadeOut)}:d=${n(fadeOut)}`,
    "-c:a",
    "aac",
    "-b:a",
    `${AUDIO_BITRATE_K}k`,
    "-ac",
    "2",
    output,
  ];
}

/** Video dongusu yeniden kodlanmadan tekrarlanir ve sesle birlestirilir. */
export function muxArgs(
  videoLoop: string,
  audio: string,
  output: string,
  targetSec: number,
): string[] {
  return [
    "-y",
    "-stream_loop",
    "-1",
    "-i",
    videoLoop,
    "-i",
    audio,
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-c",
    "copy",
    "-t",
    n(targetSec),
    output,
  ];
}

export function qaLoopArgs(videoLoop: string): string[] {
  return [
    "-i",
    videoLoop,
    "-an",
    "-vf",
    "blackdetect=d=0.5:pix_th=0.10,select='gt(scene,0.35)',metadata=print",
    "-f",
    "null",
    "-",
  ];
}

export interface LoopQa {
  blackSec: number;
  blackRanges: { start: number; end: number }[];
  sceneCuts: number[];
}

export function parseLoopQa(output: string): LoopQa {
  const blackRanges: { start: number; end: number }[] = [];
  for (const m of output.matchAll(/black_start:([\d.]+)\s+black_end:([\d.]+)/g)) {
    blackRanges.push({ start: Number(m[1]), end: Number(m[2]) });
  }
  const sceneCuts: number[] = [];
  let lastPts: number | null = null;
  for (const line of output.split(/\r?\n/)) {
    const p = /pts_time:([\d.]+)/.exec(line);
    if (p) lastPts = Number(p[1]);
    if (/lavfi\.scene_score=/.test(line) && lastPts !== null) sceneCuts.push(lastPts);
  }
  return {
    blackSec: blackRanges.reduce((s, r) => s + (r.end - r.start), 0),
    blackRanges,
    sceneCuts,
  };
}

export interface QaIssue {
  level: "warn" | "error";
  message: string;
}

export function evaluateLoopQa(qa: LoopQa, loopSec: number): QaIssue[] {
  const out: QaIssue[] = [];
  if (qa.blackSec > loopSec * 0.5)
    out.push({ level: "error", message: `Görüntünün çoğu siyah (${qa.blackSec.toFixed(1)} sn)` });
  else if (qa.blackSec > 0)
    out.push({ level: "warn", message: `Siyah kare bölümü: ${qa.blackSec.toFixed(1)} sn` });
  if (qa.sceneCuts.length)
    out.push({
      level: "warn",
      message: `Ani görüntü geçişi (${qa.sceneCuts.map((t) => t.toFixed(1)).join(", ")} sn) — uyku videosunda rahatsız edici olabilir`,
    });
  return out;
}

export function evaluateFinal(
  info: string,
  targetSec: number,
  durationSec: number | null,
  w = WIDTH,
  h = HEIGHT,
): QaIssue[] {
  const out: QaIssue[] = [];
  if (durationSec === null) out.push({ level: "error", message: "Çıktı süresi okunamadı" });
  else if (Math.abs(durationSec - targetSec) > 1.5)
    out.push({
      level: "error",
      message: `Süre uyumsuz: ${durationSec.toFixed(1)} sn (beklenen ${targetSec})`,
    });
  if (!/Video:\s*h264/.test(info)) out.push({ level: "error", message: "H.264 video akışı yok" });
  if (!/Audio:\s*aac/.test(info)) out.push({ level: "error", message: "AAC ses akışı yok" });
  if (!new RegExp(`${w}x${h}`).test(info))
    out.push({ level: "error", message: `Çözünürlük ${w}×${h} değil` });
  return out;
}

/** Cikti boyutu tahmini (bayt): dongu bit hizi x sure + ses + %5 pay. */
export function estimateOutputBytes(loopBytes: number, loopSec: number, targetSec: number): number {
  const video = (loopBytes / Math.max(loopSec, 0.1)) * targetSec;
  const audio = ((AUDIO_BITRATE_K * 1000) / 8) * targetSec;
  return Math.ceil((video + audio) * 1.05);
}

export const STAGES = [
  "video_loop",
  "loop_qa",
  "audio_loop",
  "audio_full",
  "mux",
  "final_qa",
] as const;
export type Stage = (typeof STAGES)[number];

export interface Manifest {
  key: string;
  done: Partial<Record<Stage, { at: string; data?: unknown }>>;
}

// ------------------------------------------------------------------ karanlik ekran

export const DARK_FADE_SEC = 8;
const BLACK_SEC = 60;

export interface DarkPlan {
  loops: number;
  darkAtSec: number;
  blacks: number;
}

/** Karanlik ekran plani: dongu sayisi (tam dongulerde kararir) ve gereken siyah bolum sayisi. */
export function darkPlan(
  darkAfterMin: number,
  loopSec: number,
  targetSec: number,
): DarkPlan | null {
  if (!darkAfterMin || darkAfterMin <= 0) return null;
  const loops = Math.max(1, Math.round((darkAfterMin * 60) / loopSec));
  const darkAtSec = loops * loopSec;
  if (darkAtSec + DARK_FADE_SEC + 30 >= targetSec) return null;
  const blacks = Math.ceil((targetSec - darkAtSec - DARK_FADE_SEC) / BLACK_SEC) + 1;
  return { loops, darkAtSec, blacks };
}

/** Dongunun basindan DARK_FADE_SEC saniyelik, siyaha kararan parca (dongu ile ayni kodlama). */
export function fadeToBlackArgs(loop: string, output: string, h: number): string[] {
  return [
    "-y",
    "-i",
    loop,
    "-t",
    String(DARK_FADE_SEC),
    "-vf",
    `fade=t=out:st=0:d=${DARK_FADE_SEC},setsar=1,format=yuv420p`,
    ...x264For(h),
    output,
  ];
}

/** 60 sn siyah parca (dongu ile ayni kodlama). */
export function blackArgs(output: string, w: number, h: number): string[] {
  return [
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=black:s=${w}x${h}:r=${FPS}`,
    "-t",
    String(BLACK_SEC),
    "-vf",
    "setsar=1,format=yuv420p",
    ...x264For(h),
    output,
  ];
}

/** concat listesi: dongu x N, kararma, siyah x M (dosya adlari calisma klasorune goreli). */
export function darkConcatList(plan: DarkPlan, loop: string, fade: string, black: string): string {
  const q = (f: string) => `file '${f.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`;
  return [
    ...Array.from({ length: plan.loops }, () => q(loop)),
    q(fade),
    ...Array.from({ length: plan.blacks }, () => q(black)),
  ].join("\n");
}

/** Video concat listesinden (yeniden kodlamadan) + tam sureli ses. */
export function muxConcatArgs(
  list: string,
  audio: string,
  output: string,
  targetSec: number,
): string[] {
  return [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    list,
    "-i",
    audio,
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-c",
    "copy",
    "-t",
    n(targetSec),
    output,
  ];
}
