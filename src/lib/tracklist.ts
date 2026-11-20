/**
 * Playlist bicimi: her parcaya ad, aciklamaya zaman damgali parca listesi (YouTube bolumleri).
 * YouTube kurali: ilk bolum 00:00, en az 3 bolum, her biri en az 10 sn.
 */
import { rng } from "./synth";

const NAMES: Record<string, [string[], string[]]> = {
  dark_blues: [
    [
      "Dust on the",
      "Whiskey and",
      "Midnight",
      "Long Road to",
      "Ashes of",
      "Shadows in",
      "Last Train to",
      "Smoke over",
      "Bones of",
      "Rain on",
    ],
    [
      "Highway",
      "Rain",
      "Crossroads",
      "Nowhere",
      "the Delta",
      "Memphis",
      "the River",
      "Silence",
      "Old Town",
      "the Desert",
    ],
  ],
  nordic: [
    [
      "Runes of",
      "Song of",
      "Fires of",
      "Halls of",
      "Path to",
      "Breath of",
      "Shores of",
      "Wolves of",
      "Dawn over",
      "Echoes of",
    ],
    [
      "Isa",
      "the North",
      "Yggdrasil",
      "the Fjord",
      "Valhalla",
      "the Seers",
      "Midgard",
      "Winter",
      "the Ancestors",
      "Frost",
    ],
  ],
  lofi: [
    ["Late Night", "Quiet", "Rainy", "Slow", "Paper", "Window", "Warm", "Soft", "Blue", "Sunday"],
    [
      "Notes",
      "Coffee",
      "Pages",
      "Streetlights",
      "Thoughts",
      "Study",
      "Echoes",
      "Hours",
      "Letters",
      "Dreams",
    ],
  ],
};

export function trackNames(category: string, seed: number, count: number): string[] {
  const bank = NAMES[category] ?? NAMES.lofi;
  const r = rng(seed);
  const used = new Set<string>();
  const out: string[] = [];
  let guard = 0;
  while (out.length < count && guard++ < 500) {
    const a = bank[0][Math.floor(r() * bank[0].length)];
    const b = bank[1][Math.floor(r() * bank[1].length)];
    const name = `${a} ${b}`;
    if (used.has(name) || a.split(" ").at(-1) === b.split(" ")[0]) continue;
    used.add(name);
    out.push(name);
  }
  return out;
}

export function clock(sec: number, long: boolean): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return long ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${String(m).padStart(2, "0")}:${ss}`;
}

/** Parca baslangic zamanlari (capraz gecisler dusulerek). */
export function trackStarts(durations: number[], crossfade: number): number[] {
  const starts: number[] = [];
  let t = 0;
  for (const d of durations) {
    starts.push(t);
    t += d - crossfade;
  }
  return starts;
}

/** Aciklamaya eklenecek parca listesi metni; YouTube bolum kosullari saglanmazsa null. */
export function tracklistText(input: {
  names: string[];
  durations: number[];
  crossfade: number;
  videoSec: number;
  lang: "en" | "tr";
}): string | null {
  const { names, durations, crossfade } = input;
  if (names.length < 3 || names.length !== durations.length) return null;
  const starts = trackStarts(durations, crossfade);
  const total = starts.at(-1)! + durations.at(-1)!;
  for (let i = 1; i < starts.length; i++) if (starts[i] - starts[i - 1] < 10) return null;
  const long = Math.max(total, input.videoSec) >= 3600;
  const lines = names.map((n, i) => `${clock(starts[i], long)} ${n}`);
  const repeats = input.videoSec > total * 1.05;
  const head = input.lang === "en" ? "Tracklist:" : "Parça listesi:";
  const note = repeats
    ? input.lang === "en"
      ? "(the playlist repeats until the end)"
      : "(liste video sonuna kadar tekrar eder)"
    : null;
  return [head, ...lines, ...(note ? [note] : [])].join("\n");
}
