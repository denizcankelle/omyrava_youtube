/**
 * FFmpeg ciktisini ayristirma ve kalite kurallari. Saf fonksiyonlar; test edilebilir.
 */

export interface LoudnormStats {
  input_i: number;
  input_tp: number;
  input_lra: number;
  input_thresh: number;
  target_offset: number;
}

export interface Silence {
  start: number;
  end: number;
  duration: number;
}

export interface Warning {
  level: "warn" | "error";
  message: string;
}

export interface AudioAnalysis {
  kind: "audio";
  durationSec: number | null;
  loudness: LoudnormStats | null;
  meanVolumeDb: number | null;
  maxVolumeDb: number | null;
  clippedSamples: number | null;
  silences: Silence[];
  warnings: Warning[];
}

export interface VisualAnalysis {
  kind: "visual";
  durationSec: number | null;
  width: number | null;
  height: number | null;
  sizeBytes: number | null;
  warnings: Warning[];
}

export type Analysis = AudioAnalysis | VisualAnalysis;

/** Ses kurallari. Uyku icerigi icin hedef: -18 LUFS civari, true peak <= -1 dBTP. */
export const AUDIO_RULES = {
  targetLufs: -18,
  targetTp: -2,
  targetLra: 4,
  minLufs: -26,
  maxLufs: -14,
  maxTruePeak: -1,
  maxLra: 8,
  silenceThresholdDb: -50,
  silenceMinSec: 3,
  longSilenceSec: 10,
};

export function parseLoudnorm(stderr: string): LoudnormStats | null {
  const idx = stderr.lastIndexOf("Parsed_loudnorm");
  if (idx < 0) return null;
  const start = stderr.indexOf("{", idx);
  const end = stderr.indexOf("}", start);
  if (start < 0 || end < 0) return null;
  try {
    const raw = JSON.parse(stderr.slice(start, end + 1)) as Record<string, string>;
    const num = (k: string) => {
      const v = Number(raw[k]);
      return Number.isFinite(v) ? v : NaN;
    };
    const stats = {
      input_i: num("input_i"),
      input_tp: num("input_tp"),
      input_lra: num("input_lra"),
      input_thresh: num("input_thresh"),
      target_offset: num("target_offset"),
    };
    // Tamamen sessiz dosyada loudnorm -inf verir.
    if (Object.values(stats).some((v) => Number.isNaN(v))) return null;
    return stats;
  } catch {
    return null;
  }
}

export function parseSilences(stderr: string, totalDuration: number | null): Silence[] {
  const out: Silence[] = [];
  let open: number | null = null;
  for (const line of stderr.split(/\r?\n/)) {
    const s = /silence_start:\s*(-?[\d.]+)/.exec(line);
    if (s) {
      open = Math.max(0, Number(s[1]));
      continue;
    }
    const e = /silence_end:\s*([\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)/.exec(line);
    if (e) {
      const end = Number(e[1]);
      const start = open ?? Math.max(0, end - Number(e[2]));
      out.push({ start, end, duration: end - start });
      open = null;
    }
  }
  if (open !== null && totalDuration !== null && totalDuration > open) {
    out.push({ start: open, end: totalDuration, duration: totalDuration - open });
  }
  return out;
}

export function parseVolumeDetect(stderr: string): {
  mean: number | null;
  max: number | null;
  clipped: number | null;
} {
  const mean = /mean_volume:\s*(-?[\d.]+|-inf) dB/.exec(stderr);
  const max = /max_volume:\s*(-?[\d.]+|-inf) dB/.exec(stderr);
  const h0 = /histogram_0db:\s*(\d+)/.exec(stderr);
  const n = (m: RegExpExecArray | null) => (m && m[1] !== "-inf" ? Number(m[1]) : null);
  return { mean: n(mean), max: n(max), clipped: h0 ? Number(h0[1]) : 0 };
}

export function parseVideoSize(stderr: string): { width: number; height: number } | null {
  const m = /Stream #\S+.*?Video:.*?[\s,](\d{2,5})x(\d{2,5})[\s,[]/.exec(stderr);
  return m ? { width: Number(m[1]), height: Number(m[2]) } : null;
}

const fmt = (n: number) => n.toFixed(1);

export function evaluateAudio(a: Omit<AudioAnalysis, "warnings" | "kind">): Warning[] {
  const w: Warning[] = [];
  const r = AUDIO_RULES;
  if (!a.loudness) {
    w.push({
      level: "error",
      message: "Ses seviyesi ölçülemedi (dosya sessiz veya bozuk olabilir)",
    });
  } else {
    const { input_i, input_tp, input_lra } = a.loudness;
    if (input_i < r.minLufs)
      w.push({
        level: "warn",
        message: `Çok sessiz: ${fmt(input_i)} LUFS (hedef ${r.targetLufs})`,
      });
    if (input_i > r.maxLufs)
      w.push({
        level: "warn",
        message: `Çok yüksek: ${fmt(input_i)} LUFS (hedef ${r.targetLufs})`,
      });
    if (input_tp > r.maxTruePeak)
      w.push({
        level: "warn",
        message: `Tepe seviyesi yüksek: ${fmt(input_tp)} dBTP (en fazla ${r.maxTruePeak})`,
      });
    if (input_lra > r.maxLra)
      w.push({
        level: "warn",
        message: `Ses seviyesi çok dalgalı (LRA ${fmt(input_lra)} LU) — ani yükselmeler uykuyu bölebilir`,
      });
  }
  if ((a.clippedSamples ?? 0) > 0 || (a.maxVolumeDb !== null && a.maxVolumeDb >= -0.1)) {
    w.push({
      level: "error",
      message: `Clipping şüphesi: 0 dB'ye ulaşan ${a.clippedSamples ?? "?"} örnek var`,
    });
  }
  const dur = a.durationSec ?? Infinity;
  for (const s of a.silences) {
    const atEdge = s.start < 0.5 || s.end > dur - 0.5;
    if (!atEdge && s.duration >= r.longSilenceSec) {
      w.push({
        level: "warn",
        message: `Uzun sessizlik: ${fmt(s.start)}–${fmt(s.end)} sn (${fmt(s.duration)} sn)`,
      });
    }
  }
  const lead = a.silences.find((s) => s.start < 0.5);
  if (lead && lead.duration > 2)
    w.push({ level: "warn", message: `Başta ${fmt(lead.duration)} sn sessizlik var` });
  if (a.durationSec !== null && a.durationSec < 30)
    w.push({ level: "warn", message: "Ses 30 saniyeden kısa" });
  return w;
}

export function evaluateVisual(
  type: "image" | "video_loop" | "thumbnail",
  v: {
    width: number | null;
    height: number | null;
    durationSec: number | null;
    sizeBytes: number | null;
  },
): Warning[] {
  const w: Warning[] = [];
  if (!v.width || !v.height) {
    w.push({ level: "error", message: "Görüntü boyutu okunamadı" });
    return w;
  }
  const ratio = v.width / v.height;
  if (Math.abs(ratio - 16 / 9) > 0.02)
    w.push({ level: "warn", message: `En-boy oranı 16:9 değil (${v.width}×${v.height})` });
  if (type === "thumbnail") {
    if (v.width < 1280) w.push({ level: "warn", message: "Kapak en az 1280×720 olmalı" });
    if ((v.sizeBytes ?? 0) > 2 * 1024 * 1024)
      w.push({ level: "error", message: "Kapak 2 MB'tan büyük (YouTube sınırı)" });
  } else if (v.width < 1920 || v.height < 1080) {
    w.push({ level: "warn", message: `1080p için düşük çözünürlük (${v.width}×${v.height})` });
  }
  if (type === "video_loop" && v.durationSec !== null && v.durationSec < 5)
    w.push({ level: "warn", message: "Video döngü 5 saniyeden kısa; tekrar çok belirgin olur" });
  return w;
}

/** Iki gecisli loudnorm icin filtre (olculen degerlerle) + fade. */
export function buildNormalizeFilter(
  stats: LoudnormStats,
  durationSec: number,
  opts: { fadeInSec?: number; fadeOutSec?: number } = {},
): string {
  const r = AUDIO_RULES;
  const fadeIn = Math.min(opts.fadeInSec ?? 5, durationSec * 0.1);
  const fadeOut = Math.min(opts.fadeOutSec ?? 10, durationSec * 0.1);
  const parts = [
    `loudnorm=I=${r.targetLufs}:TP=${r.targetTp}:LRA=${r.targetLra}` +
      `:measured_I=${stats.input_i}:measured_TP=${stats.input_tp}:measured_LRA=${stats.input_lra}` +
      `:measured_thresh=${stats.input_thresh}:offset=${stats.target_offset}:linear=true:print_format=summary`,
  ];
  if (fadeIn > 0) parts.push(`afade=t=in:st=0:d=${fadeIn.toFixed(2)}`);
  if (fadeOut > 0)
    parts.push(`afade=t=out:st=${(durationSec - fadeOut).toFixed(2)}:d=${fadeOut.toFixed(2)}`);
  return parts.join(",");
}
