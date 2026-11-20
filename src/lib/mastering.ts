/**
 * Kategori bazli mastering zinciri (ses tasarimi kurallari):
 * - Sifir dinamik sok: yumusak kompresor + brickwall limiter
 * - Merkez agirlikli stereo (sert panlama yok)
 * - Kategoriye gore tonal sekillendirme (kulak yorucu 3-5 kHz bolgesi tiraslanir)
 * Ardindan iki gecisli loudnorm (-18 LUFS, -2 dBTP, LRA 4) uygulanir.
 */
export type MasterCategory =
  | "deep_sleep"
  | "rain"
  | "meditation"
  | "cosmic"
  | "piano"
  | "piano_violin"
  | "nordic"
  | "strings"
  | "ocean"
  | "lofi"
  | "dark_blues";

const BASE_PRE = [
  "highpass=f=30",
  // Stereo genisligini merkeze dogru daralt (m<1): sert sag-sol ayrimini yumusatir
  "extrastereo=m=0.75:c=false",
];

const TONE: Record<MasterCategory, string[]> = {
  // Sicak, koyu: 3-5 kHz bolgesi agresif tiraslanir
  deep_sleep: ["equalizer=f=4000:t=q:w=1:g=-6", "lowpass=f=3200:p=2"],
  // Dogal pembe gurultu: 8 kHz ustu yuvarlatilir, 250-500 Hz dengelenir
  rain: ["highshelf=f=8000:g=-5", "equalizer=f=350:t=q:w=0.8:g=2"],
  // Ferah ama parlak olmayan orta bolge
  meditation: ["highshelf=f=4500:g=-3", "equalizer=f=1000:t=q:w=0.7:g=1"],
  cosmic: ["highshelf=f=6000:g=-3", "equalizer=f=3500:t=q:w=1:g=-2"],
  // Kece piyano tinisi: cekic/tuse parlakligi yumusatilir (yagmur altta kalir)
  piano: ["highshelf=f=4000:g=-5", "equalizer=f=2800:t=q:w=1:g=-3", "lowpass=f=7000"],
  // Kopuk sesi hafif: 2–4 kHz yumusatilir
  ocean: ["highshelf=f=6000:g=-3", "equalizer=f=2500:t=q:w=1:g=-2"],
  // Analog sicaklik: ust frekanslar yuvarlatilir
  lofi: ["highshelf=f=5000:g=-4", "lowpass=f=9500", "equalizer=f=250:t=q:w=1:g=1"],
  // Dark blues: sicak alt-orta (gitar govdesi), sert telli tinilar hafif yuvarlatilir
  dark_blues: [
    "equalizer=f=180:t=q:w=1:g=1.5",
    "equalizer=f=3200:t=q:w=1:g=-2",
    "highshelf=f=7000:g=-2",
  ],
  piano_violin: ["highshelf=f=5000:g=-4", "equalizer=f=3500:t=q:w=1:g=-2"],
  strings: ["highshelf=f=5000:g=-4", "equalizer=f=3500:t=q:w=1:g=-2"],
  nordic: ["highshelf=f=6000:g=-3", "equalizer=f=3500:t=q:w=1:g=-2"],
};

/** Yavas, yumusak kompresor: ani tuse/perkusyon piklerini ve dinamik farki toplar. */
const COMPRESSOR = "acompressor=threshold=0.1:ratio=2.5:attack=50:release=800:knee=4:makeup=1";

/**
 * Tuse/akor vuruslu kategorilerde daha hizli ve derin kompresor: tek bir nota gece boyunca
 * digerlerinden sivrilmesin (olcum: anlik yukseklik +7 LU -> ~+3.5 LU).
 */
const COMPRESSOR_FOR: Partial<Record<MasterCategory, string>> = {
  piano: "acompressor=threshold=0.045:ratio=3:attack=12:release=1500:knee=6:makeup=1",
  lofi: "acompressor=threshold=0.05:ratio=3:attack=15:release=1200:knee=6:makeup=1",
  // Slide gitar cumleleri: tepeler toplanir ama blues'un nefesi korunur
  dark_blues: "acompressor=threshold=0.06:ratio=2.8:attack=10:release=900:knee=6:makeup=1",
};

export function isMasterCategory(c: string): c is MasterCategory {
  return c in TONE;
}

/** Olcumden once uygulanan on zincir (EQ + stereo + kompresor). */
export function masterPreChain(category: string): string {
  const tone = isMasterCategory(category) ? TONE[category] : [];
  const comp = (isMasterCategory(category) && COMPRESSOR_FOR[category]) || COMPRESSOR;
  return [...BASE_PRE, ...tone, comp].join(",");
}

/** loudnorm sonrasi brickwall limiter: -2 dBTP tavanini kesin tutar. */
export const LIMITER = "alimiter=limit=0.79:attack=5:release=200:level=false";
