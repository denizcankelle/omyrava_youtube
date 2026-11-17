/** Kategoriye gore otomatik uretim tarifleri (yapay zekasiz). */
import type { MusicStyle } from "./composer";
import type { SynthPreset } from "./synth";
import type { VisualPreset } from "./visual";

type Category =
  | "deep_sleep"
  | "rain"
  | "meditation"
  | "cosmic"
  | "piano"
  | "piano_violin"
  | "nordic"
  | "strings"
  | "ocean"
  | "lofi";

export interface Recipe {
  /** Uretilecek ses parcalari (her biri farkli seed): sentez sesi veya besteci muzigi. */
  tracks: ({ preset: SynthPreset; minutes: number } | { music: MusicStyle; minutes: number })[];
  /** Tum sure boyunca altta calan katman. */
  bed?: { preset: SynthPreset; minutes: number; db: number };
  visual: VisualPreset;
  /** Metaveri sablonu icin kategori (piyano yokken meditasyon). */
  metaCategory: Category;
  thumb: { en: string; tr: string };
  note?: string;
}

const rep = (preset: SynthPreset, n: number, minutes = 15) =>
  Array.from({ length: n }, () => ({ preset, minutes }));
const music = (style: MusicStyle, n: number, minutes = 15) =>
  Array.from({ length: n }, () => ({ music: style, minutes }));

export const RECIPES: Record<Category, Recipe> = {
  deep_sleep: {
    // Derin ambient: melodi yok; 2–3 ses 15–30 sn'de yukselip kaybolarak birbirine karisir.
    // Tek uzun parca: farkli tonalitelerin capraz gecisi olmaz.
    tracks: [{ preset: "deep_ambient", minutes: 45 }],
    visual: "night_sky",
    metaCategory: "deep_sleep",
    thumb: { en: "DEEP SLEEP", tr: "DERİN UYKU" },
  },
  rain: {
    // Camin arkasindan esit yagmur; altta kadife sicak ambient (akorlar 30–60 sn'de degisir).
    tracks: rep("rain_glass", 3),
    bed: { preset: "ambient_warm", minutes: 15, db: -9 },
    visual: "rain_window",
    metaCategory: "rain",
    thumb: { en: "RAIN & AMBIENT", tr: "YAĞMUR & AMBİYANS" },
  },
  meditation: {
    tracks: rep("pad", 4),
    bed: { preset: "rain_light", minutes: 15, db: -20 },
    visual: "mist",
    metaCategory: "meditation",
    thumb: { en: "MEDITATION", tr: "MEDİTASYON" },
  },
  cosmic: {
    tracks: [...music("deep_sleep", 2), ...rep("drone", 1)],
    visual: "starry_sky",
    metaCategory: "cosmic",
    thumb: { en: "COSMIC SLEEP", tr: "KOZMİK UYKU" },
  },
  piano: {
    // Kece piyano: 4–8 sn'de bir tek nota/iki notali motif; yagmur aradaki boslugu doldurur.
    tracks: music("felt_piano", 3),
    bed: { preset: "rain_glass", minutes: 15, db: -1 },
    visual: "rain_window",
    metaCategory: "piano",
    thumb: { en: "SOFT PIANO & RAIN", tr: "PİYANO & YAĞMUR" },
  },
  piano_violin: {
    tracks: music("piano_violin", 3),
    visual: "mist",
    metaCategory: "piano_violin",
    thumb: { en: "PIANO & VIOLIN", tr: "PİYANO & KEMAN" },
  },
  nordic: {
    tracks: music("nordic", 3),
    bed: { preset: "wind", minutes: 15, db: -20 },
    visual: "aurora",
    metaCategory: "nordic",
    thumb: { en: "NORDIC AMBIENT", tr: "İSKANDİNAV AMBİYANS" },
  },
  strings: {
    tracks: music("strings", 3),
    visual: "starry_sky",
    metaCategory: "strings",
    thumb: { en: "WARM STRINGS", tr: "SICAK YAYLILAR" },
  },
  ocean: {
    // Uzak, kucuk dalgalar (8–15 sn); altta sabit ve sicak ambient.
    tracks: rep("waves_soft", 3),
    bed: { preset: "ambient_warm", minutes: 15, db: -10 },
    visual: "mist",
    metaCategory: "ocean",
    thumb: { en: "OCEAN WAVES", tr: "OKYANUS DALGALARI" },
  },
  lofi: {
    // Davulsuz lo-fi; plak dokusu tekil patlama duyulmayacak kadar geride.
    tracks: music("lofi", 3),
    bed: { preset: "vinyl_hiss", minutes: 15, db: -30 },
    visual: "night_sky",
    metaCategory: "lofi",
    thumb: { en: "LO-FI NO DRUMS", tr: "DAVULSUZ LO-FI" },
  },
};

export function thumbText(recipe: Recipe, durationSec: number, lang: "en" | "tr"): string {
  const h = Math.round((durationSec / 3600) * 10) / 10;
  const top = lang === "en" ? `${h} HOUR${h === 1 ? "" : "S"}` : `${h} SAAT`;
  return `${top}\n${recipe.thumb[lang]}`;
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 900_000) + 100_000;
}
