/**
 * Ses rahatlik denetimi (docs/ses-kurallari.md): kulagi yoran iki bolge olculur ve sinir
 * asilirsa otomatik yumusatilir.
 *  - "sertlik": 2–5 kHz bandinin toplam sese orani (kulagin en duyarli oldugu bolge)
 *  - "tizlik": 6 kHz ustunun toplam sese orani (hisirti, parlaklik)
 * Arastirma: uyku muzigini ayiran en guclu ozellik dusuk parlakliktir (Kirk & Timmers 2024).
 */
export type ComfortClass = "sleep" | "nature" | "listen";

export interface ComfortLimits {
  /** 2–5 kHz bandi, toplam seviyeye gore en fazla (dB). */
  presence: number;
  /** 6 kHz ustu, toplam seviyeye gore en fazla (dB). */
  air: number;
}

/** Olculen mevcut iyi ornekler (kece piyano, derin uyku) referans alinarak belirlendi. */
export const COMFORT_LIMITS: Record<ComfortClass, ComfortLimits> = {
  // Tonal uyku muzigi: en koyu
  sleep: { presence: -18, air: -30 },
  // Yagmur/dalga iceren: gurultu dogasi geregi daha genis bantli, ama "kahverengi" karakterde
  nature: { presence: -13, air: -21 },
  // Dinleme turleri (lo-fi, nordic, dark blues)
  listen: { presence: -15, air: -24 },
};

const CLASS_OF: Record<string, ComfortClass> = {
  deep_sleep: "sleep",
  meditation: "sleep",
  cosmic: "sleep",
  piano_violin: "sleep",
  strings: "sleep",
  felt_piano: "sleep",
  rain: "nature",
  ocean: "nature",
  piano: "sleep",
  lofi: "listen",
  nordic: "listen",
  nordic_ritual: "listen",
  dark_blues: "listen",
};

export function comfortClass(categoryOrStyle: string): ComfortClass {
  return CLASS_OF[categoryOrStyle] ?? "sleep";
}

export interface ComfortMetrics {
  /** Toplam ortalama seviye (dBFS). */
  full: number;
  /** 2–5 kHz bandinin toplama orani (dB, negatif). */
  presence: number;
  /** 6 kHz ustunun toplama orani (dB, negatif). */
  air: number;
}

export interface ComfortResult extends ComfortMetrics {
  cls: ComfortClass;
  limits: ComfortLimits;
  ok: boolean;
}

/** Olcum icin filtre grafigi; `pre` verilirse once o zincir uygulanir. */
export function comfortGraph(pre?: string): string {
  const head = pre ? `[0:a]${pre},asplit=3[a][b][c]` : "[0:a]asplit=3[a][b][c]";
  return (
    `${head};[a]volumedetect[o1];` +
    "[b]highpass=f=2000:p=2,lowpass=f=5000:p=2,volumedetect[o2];" +
    "[c]highpass=f=6000:p=2,volumedetect[o3]"
  );
}

export function comfortArgs(input: string, pre?: string): string[] {
  return [
    "-hide_banner",
    "-nostats",
    "-i",
    input,
    "-vn",
    "-filter_complex",
    comfortGraph(pre),
    "-map",
    "[o1]",
    "-f",
    "null",
    "-",
    "-map",
    "[o2]",
    "-f",
    "null",
    "-",
    "-map",
    "[o3]",
    "-f",
    "null",
    "-",
  ];
}

/** FFmpeg ciktisindan uc volumedetect ortalamasini (filtre sirasina gore) okur. */
export function parseComfort(stderr: string): ComfortMetrics | null {
  const found = new Map<number, number>();
  const re = /Parsed_volumedetect_(\d+)[^\n]*mean_volume:\s*(-?[\d.]+|-inf)\s*dB/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stderr))) found.set(Number(m[1]), m[2] === "-inf" ? -120 : Number(m[2]));
  const v = [...found.entries()].sort((x, y) => x[0] - y[0]).map((e) => e[1]);
  if (v.length !== 3 || v[0] <= -90) return null;
  const r = (x: number) => Math.round(x * 10) / 10;
  return { full: r(v[0]), presence: r(v[1] - v[0]), air: r(v[2] - v[0]) };
}

export function evaluateComfort(m: ComfortMetrics, cls: ComfortClass): ComfortResult {
  const limits = COMFORT_LIMITS[cls];
  // 0.5 dB olcum payi
  const ok = m.presence <= limits.presence + 0.5 && m.air <= limits.air + 0.5;
  return { ...m, cls, limits, ok };
}

/**
 * Siniri asan bolgeler icin duzeltici EQ. Genis ve yumusak egriler kullanilir (dar centik
 * yapay duyulur). Bos dizi = duzeltme gerekmez.
 */
export function comfortFix(m: ComfortMetrics, cls: ComfortClass): string[] {
  const l = COMFORT_LIMITS[cls];
  const out: string[] = [];
  const over = (x: number, max: number) => Math.min(max, Math.ceil((x + 1) * 2) / 2);
  const p = m.presence - l.presence;
  const a = m.air - l.air;
  // Genis can egrisi band ortalamasini kazancin ~%70'i kadar dusurur: payi buna gore buyut
  if (p > 0) out.push(`equalizer=f=3200:t=o:w=1.4:g=-${over(p * 1.4, 10)}`);
  // Sertlik kesimi tizi de bir miktar indirir; kalan fark icin raf filtresi
  const aLeft = a - (p > 0 ? Math.min(p, 3) * 0.3 : 0);
  if (aLeft > 0) out.push(`highshelf=f=6000:g=-${over(aLeft * 1.2, 14)}`);
  return out;
}

export function comfortSummary(c: ComfortResult): string {
  return `sertlik ${c.presence} dB (en çok ${c.limits.presence}), tizlik ${c.air} dB (en çok ${c.limits.air})`;
}
