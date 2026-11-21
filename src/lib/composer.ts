/**
 * Algoritmik besteci (yapay zekasiz). Seed + stil + sureden, SoundFont ile calinacak
 * nota olaylari uretir. Muzik teorisi: mod/gam, akor dizileri, motif tekrari ve varyasyonu,
 * cumle yapisi (giris - ana - kapanis), dinamik ve insansi zamanlama.
 */
import { rng } from "./synth";

export const MUSIC_STYLES = {
  nordic: { label: "İskandinav / Viking ambient", en: "Nordic Viking Ambient" },
  piano: { label: "Solo piyano", en: "Soft Piano" },
  piano_violin: { label: "Romantik piyano (solo)", en: "Romantic Piano" },
  strings: { label: "Yaylılar ve çello (kullanımdan kalktı)", en: "Warm Strings & Cello" },
  deep_sleep: { label: "Derin uyku ambiyansı (pad + piyano)", en: "Deep Sleep Ambient" },
  felt_piano: { label: "Keçe piyano (seyrek, melodisiz)", en: "Soft Felt Piano" },
  lofi: { label: "Davulsuz lo-fi (elektrikli piyano)", en: "Drumless Lo-fi" },
  nordic_ritual: {
    label: "İskandinav ritüel (drone, çerçeve davulu, kadın vokali, arp)",
    en: "Nordic Ritual Dark Folk",
  },
  dark_blues: { label: "Dark blues (slide gitar, shuffle)", en: "Dark Blues" },
} as const;

export type MusicStyle = keyof typeof MUSIC_STYLES;

export type MusicEvent =
  | { t: number; type: "program"; ch: number; program: number }
  | { t: number; type: "cc"; ch: number; cc: number; value: number }
  | { t: number; type: "on"; ch: number; note: number; vel: number }
  | { t: number; type: "off"; ch: number; note: number }
  /** Perde bukme (0..16383, 8192 = orta; varsayilan aralik +-2 yarim ton). */
  | { t: number; type: "bend"; ch: number; value: number };

// Kanal / enstruman (General MIDI program numaralari)
const CH = {
  piano: 0,
  violin: 1,
  cello: 2,
  strings: 3,
  choir: 4,
  drum: 5,
  bass: 6,
  horn: 7,
  pad: 8,
} as const;
const PROGRAM: Record<number, number> = {
  0: 0,
  1: 40,
  2: 42,
  3: 49,
  4: 52,
  5: 116,
  6: 43,
  7: 60,
  8: 89,
};
const VOLUME: Record<number, number> = {
  0: 100,
  1: 92,
  2: 88,
  3: 72,
  4: 68,
  5: 84,
  6: 84,
  7: 64,
  8: 90,
};
const PAN: Record<number, number> = {
  0: 64,
  1: 70,
  2: 58,
  3: 64,
  4: 62,
  5: 64,
  6: 62,
  7: 67,
  8: 64,
};

const MODES = {
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  ionian: [0, 2, 4, 5, 7, 9, 11],
} as const;
type Mode = keyof typeof MODES;

/** Derece dizileri (0 = tonik). */
const PROGRESSIONS: Record<Mode, number[][]> = {
  aeolian: [
    [0, 5, 2, 6],
    [0, 3, 5, 4],
    [0, 6, 5, 6],
    [0, 5, 3, 4],
    [0, 3, 6, 2],
  ],
  dorian: [
    [0, 3, 0, 6],
    [0, 6, 3, 0],
    [0, 2, 3, 6],
  ],
  ionian: [
    [0, 4, 5, 3],
    [0, 3, 5, 4],
    [5, 3, 0, 4],
    [0, 5, 3, 4],
    [3, 4, 2, 5],
  ],
};

interface StyleSpec {
  tempo: [number, number];
  modes: Mode[];
  roots: number[]; // tonik pitch class
  barsPerChord: number[];
}

const SPECS: Record<MusicStyle, StyleSpec> = {
  nordic: { tempo: [54, 62], modes: ["dorian", "aeolian"], roots: [2, 4, 9, 7], barsPerChord: [2] },
  piano: {
    tempo: [58, 70],
    modes: ["ionian", "aeolian"],
    roots: [0, 2, 4, 5, 7, 9],
    barsPerChord: [1, 2],
  },
  piano_violin: {
    tempo: [56, 66],
    modes: ["aeolian", "ionian"],
    roots: [2, 4, 7, 9, 0],
    barsPerChord: [1, 2],
  },
  strings: {
    tempo: [48, 56],
    modes: ["ionian", "aeolian"],
    roots: [0, 2, 5, 7, 9],
    barsPerChord: [2],
  },
  deep_sleep: {
    tempo: [44, 52],
    modes: ["ionian", "aeolian"],
    roots: [0, 2, 5, 7, 9],
    barsPerChord: [2],
  },
  felt_piano: {
    tempo: [50, 60],
    modes: ["ionian", "aeolian"],
    roots: [0, 2, 4, 5, 7, 9],
    barsPerChord: [1],
  },
  lofi: {
    tempo: [55, 65],
    modes: ["ionian", "dorian"],
    roots: [0, 2, 3, 5, 7, 10],
    barsPerChord: [1],
  },
  nordic_ritual: {
    tempo: [60, 68],
    modes: ["dorian", "aeolian"],
    roots: [2, 4, 9, 7],
    barsPerChord: [2],
  },
  dark_blues: { tempo: [58, 68], modes: ["aeolian"], roots: [4, 9, 2, 7], barsPerChord: [1] },
};

/** Stile ozel enstruman degisiklikleri (GM program). */
const PROGRAM_OVERRIDE: Partial<Record<MusicStyle, Record<number, number>>> = {
  // Elektrikli piyano (Rhodes) + parmakla calinan bas
  lofi: { 0: 4, 6: 33 },
  // Arp, hardanger tarzi keman (Fiddle), cello+kontrbas drone, kadin "ooo" vokali, flut
  nordic_ritual: { 0: 46, 1: 110, 4: 53, 7: 73 },
  // Ritim: celik akustik; solo: temiz elektro (slide); bas: parmak; pad: hammond org
  dark_blues: { 0: 25, 1: 27, 6: 33, 8: 16 },
};
const REVERB: Partial<Record<MusicStyle, number>> = {
  piano: 85,
  felt_piano: 118,
  lofi: 72,
  // Bu stillerde mekan yankisini asil olarak konvolusyon reverb verir (music.ts)
  nordic: 70,
  nordic_ritual: 64,
  dark_blues: 48,
};
/**
 * Daha kaliteli enstruman bankasi (GeneralUser GS, ticari muzik uretimine izinli): bu stillerde
 * kullanilir; dosya yoksa FluidR3_GM'e donulur.
 */
export const GENERALUSER_FILE = "GeneralUser-GS.sf2";
export const STYLE_BANK: Partial<Record<MusicStyle, "generaluser">> = {
  nordic: "generaluser",
  nordic_ritual: "generaluser",
  dark_blues: "generaluser",
  lofi: "generaluser",
  strings: "generaluser",
  piano_violin: "generaluser",
};

const VOLUME_OVERRIDE: Partial<Record<MusicStyle, Record<number, number>>> = {
  nordic_ritual: { 0: 70, 1: 78, 2: 96, 4: 92, 5: 82, 6: 88, 7: 60, 8: 66 },
  dark_blues: { 0: 72, 1: 100, 6: 92, 8: 44 },
};

class Key {
  constructor(
    public root: number,
    public mode: Mode,
  ) {}
  /** Derece -> MIDI notasi; base: oktavin C notasi (or. 48 = C3). */
  note(degree: number, base: number): number {
    const s = MODES[this.mode];
    const oct = Math.floor(degree / 7);
    const d = ((degree % 7) + 7) % 7;
    return base + this.root + s[d] + 12 * oct;
  }
  triad(degree: number): number[] {
    return [degree, degree + 2, degree + 4];
  }
}

export function composeMusic(style: MusicStyle, seed: number, durationSec: number) {
  const r = rng(seed);
  const pick = <T>(a: readonly T[]): T => a[Math.floor(r() * a.length)];
  const between = (a: number, b: number) => a + r() * (b - a);
  const spec = SPECS[style];
  const tempo = Math.round(between(spec.tempo[0], spec.tempo[1]));
  const beat = 60 / tempo;
  const bar = beat * 4;
  const events: MusicEvent[] = [];
  const jitter = () => (r() - 0.5) * 0.024;
  const vel = (v: number) => Math.max(1, Math.min(127, Math.round(v + (r() - 0.5) * 12)));

  for (const [chs, program] of Object.entries(PROGRAM)) {
    const ch = Number(chs);
    events.push({ t: 0, type: "program", ch, program: PROGRAM_OVERRIDE[style]?.[ch] ?? program });
    events.push({ t: 0, type: "cc", ch, cc: 7, value: VOLUME_OVERRIDE[style]?.[ch] ?? VOLUME[ch] });
    events.push({ t: 0, type: "cc", ch, cc: 10, value: PAN[ch] });
    events.push({ t: 0, type: "cc", ch, cc: 91, value: REVERB[style] ?? 105 });
    events.push({
      t: 0,
      type: "cc",
      ch,
      cc: 93,
      value:
        ch === CH.strings || ch === CH.choir ? 30 : style === "lofi" && ch === CH.piano ? 45 : 8,
    });
    events.push({ t: 0, type: "cc", ch, cc: 11, value: 100 });
  }

  // Ayni kanalda ayni nota tekrar calinirsa onceki notayi biraz once kapat; aksi halde
  // onceki notanin kapanisi yeni notanin sesini keser.
  const sounding = new Map<string, { on: { t: number }; off: { t: number } }>();
  const note = (ch: number, n: number, t: number, d: number, v: number, swell = false) => {
    if (t >= durationSec - 0.2) return;
    t = Math.max(0, t);
    const key = `${ch}:${n}`;
    const prev = sounding.get(key);
    if (prev && prev.off.t > t - 0.01) {
      if (t - 0.01 <= prev.on.t + 0.02) return; // neredeyse ayni anda: yinelenen notayi atla
      prev.off.t = t - 0.01;
    }
    const end = Math.min(t + d, durationSec - 0.1);
    const on = { t, type: "on" as const, ch, note: n, vel: vel(v) };
    const off = { t: end, type: "off" as const, ch, note: n };
    events.push(on);
    events.push(off);
    sounding.set(key, { on, off });
    if (swell) {
      // Yaylilarda nefes alan ses: yumusak baslangic, ortada dolgunluk, sonda hafif cekilme
      const steps = Math.max(3, Math.floor((end - t) / 0.15));
      for (let i = 0; i <= steps; i++) {
        const x = i / steps;
        const e = x < 0.4 ? 55 + (x / 0.4) * 50 : 105 - ((x - 0.4) / 0.6) * 25;
        events.push({ t: t + x * (end - t), type: "cc", ch, cc: 11, value: Math.round(e) });
      }
    }
  };

  // --- Iskandinav rituel / dark folk: drone + kalp atisi davul + sozsuz kadin vokali ---
  // Bolum dongusu: giris (drone) -> davul + arp -> vokal ve keman cevabi -> doruk (koro pad)
  // -> cozulme. Her dongude tonalite bazen besli/dortlu kayar.
  if (style === "nordic_ritual") {
    let key = new Key(pick(spec.roots), pick(spec.modes));
    let tt = 0.3;
    let cycle = 0;
    const SECTIONS: [string, number][] = [
      ["intro", 4],
      ["verse", 8],
      ["song", 12],
      ["peak", 6],
      ["release", 6],
    ];
    const lowFit = (n: number, lo: number, hi: number) => {
      while (n > hi) n -= 12;
      while (n < lo) n += 12;
      return n;
    };
    while (tt < durationSec - bar * 4) {
      if (cycle > 0 && r() < 0.5) key = new Key((key.root + pick([5, 7])) % 12, key.mode);
      const prog = pick(PROGRESSIONS[key.mode]);
      let deg = prog[0];
      let melodyDeg = 4;
      let bi = 0;
      for (const [sec, bars] of SECTIONS) {
        if (tt >= durationSec - bar * 4) break;
        const secStart = tt;
        const secLen = bars * bar;
        // Drone: cello kok + besli, kontrbas kok; bolum boyunca nefes alarak (swell)
        note(
          CH.cello,
          lowFit(key.note(0, 36), 36, 47),
          secStart,
          secLen * 0.995,
          sec === "intro" ? 52 : 64,
          true,
        );
        note(
          CH.cello,
          lowFit(key.note(4, 36), 43, 54),
          secStart + 0.05,
          secLen * 0.995,
          sec === "intro" ? 40 : 52,
          true,
        );
        if (sec !== "intro")
          note(CH.bass, lowFit(key.note(0, 24), 26, 38), secStart, secLen * 0.995, 58, true);
        if (sec === "peak")
          for (const d of key.triad(0))
            note(CH.pad, key.note(d, 48), secStart, secLen * 0.99, 50, true);
        for (let b = 0; b < bars && tt < durationSec - bar; b++, bi++) {
          if (b % 2 === 0) deg = prog[((bi / 2) % prog.length) | 0];
          const triad = key.triad(deg);
          const dyn = sec === "intro" ? 0.6 : sec === "release" ? 0.7 : sec === "peak" ? 1.05 : 0.9;
          // Davul: "lub-dub" kalp atisi; dorukta sekizlik dolgu
          if (sec !== "intro" && !(sec === "release" && b >= bars - 2)) {
            const low = lowFit(key.note(0, 36), 36, 47);
            for (const k of [0, 2]) {
              note(CH.drum, low, tt + k * beat + jitter(), beat, 56 * dyn);
              note(CH.drum, low, tt + k * beat + beat * 0.38 + jitter(), beat * 0.5, 38 * dyn);
            }
            if (sec === "peak" && b % 2 === 1)
              for (let k = 0; k < 4; k++)
                note(CH.drum, low + 7, tt + (2 + k * 0.5) * beat, beat * 0.4, 34 + k * 4);
          }
          // Arp: ayrik akor notalari (verse, song)
          if (sec === "verse" || sec === "song") {
            const arp = [triad[0], triad[1], triad[2], triad[0] + 7].map((d) => key.note(d, 60));
            const pattern = r() < 0.5 ? [0, 2, 1, 3, 2, 1] : [0, 1, 2, 3, 2, 1];
            pattern.forEach((pIdx, i) => {
              if (r() < 0.25) return;
              note(
                CH.piano,
                lowFit(arp[pIdx], 55, 79),
                tt + i * (bar / 6) + jitter(),
                bar / 3,
                40 * dyn,
              );
            });
          }
          // Vokal: iki olculuk uzun nota cumleleri, adim adim hareket, akor notasinda biter
          if ((sec === "song" || sec === "peak" || (sec === "release" && b < 2)) && b % 4 < 2) {
            if (b % 4 === 0) {
              const lens = pick([
                [3, 1, 4],
                [2, 2, 4],
                [4, 2, 2],
                [2, 1, 1, 4],
              ]);
              let at = tt;
              const phrase: number[] = [];
              lens.forEach((len, i) => {
                melodyDeg += pick([-1, 1, 1, -1, 0, 2, -2]);
                if (melodyDeg > 9) melodyDeg -= 2;
                if (melodyDeg < 2) melodyDeg += 2;
                if (i === lens.length - 1) {
                  const targets = key.triad(deg).flatMap((d) => [d, d + 7]);
                  melodyDeg = [...targets].sort(
                    (x, y) => Math.abs(x - melodyDeg) - Math.abs(y - melodyDeg),
                  )[0];
                }
                const n = lowFit(key.note(melodyDeg, 60), 62, 79);
                phrase.push(n);
                note(CH.choir, n, at, len * beat * 0.98, (sec === "peak" ? 76 : 66) * dyn, true);
                at += len * beat;
              });
              // Keman cevabi: cumlenin son iki notasi bir oktav asagida, iki olcu sonra
              if (r() < 0.6)
                phrase
                  .slice(-2)
                  .forEach((n, i) =>
                    note(
                      CH.violin,
                      n - 12,
                      tt + bar * 2 + i * beat * 2,
                      beat * 1.95,
                      58 * dyn,
                      true,
                    ),
                  );
            }
          }
          // Flut: seyrek, uzak bir cagri (song)
          if (sec === "song" && b === 6 && r() < 0.7) {
            const n = lowFit(key.note(pick([4, 7, 9]), 72), 72, 86);
            note(CH.horn, n, tt + beat, bar * 1.4, 44, true);
          }
          tt += bar;
        }
      }
      cycle++;
    }
    const endT = Math.min(tt, durationSec - 8);
    if (endT > 0) {
      note(CH.cello, lowFit(key.note(0, 36), 36, 47), endT, 7, 50, true);
      note(CH.choir, lowFit(key.note(0, 60), 62, 74), endT + 0.5, 6, 48, true);
    }
    events.sort((a, b) => a.t - b.t || order(a) - order(b));
    return {
      events,
      tempo,
      description: `${MUSIC_STYLES[style].label}, ${tempo} BPM, ${cycle} döngü (${["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"][key.root]} ${key.mode})`,
    };
  }

  // --- Dark blues: 12 olculuk minor blues, 12/8 shuffle, slide solo (perde bukme ile) ---
  if (style === "dark_blues") {
    const root = pick(spec.roots);
    const DR = 9; // GM vurmali kanal
    events.push({ t: 0, type: "cc", ch: DR, cc: 7, value: 74 });
    events.push({ t: 0, type: "cc", ch: DR, cc: 91, value: 40 });
    events.push({ t: 0, type: "cc", ch: DR, cc: 10, value: 64 });
    const t3 = beat / 3; // uclu bolum (shuffle)
    const FORM = [0, 0, 0, 0, 5, 5, 0, 0, 7, 5, 0, 7]; // i i i i iv iv i i v iv i v
    const PENT = [0, 3, 5, 6, 7, 10]; // minor pentatonik + blue note
    const fit = (n: number, lo: number, hi: number) => {
      while (n > hi) n -= 12;
      while (n < lo) n += 12;
      return n;
    };
    const bendTo = (ch: number, t: number, from: number, dur: number) => {
      // from: yarim ton (negatif = alttan kayarak gel)
      const steps = 8;
      for (let i = 0; i <= steps; i++) {
        const x = i / steps;
        const semis = from * (1 - x * x * (3 - 2 * x));
        events.push({ t: t + x * dur, type: "bend", ch, value: Math.round(8192 + semis * 4096) });
      }
    };
    const vibrato = (ch: number, t: number, dur: number) => {
      for (let x = 0.25; x < dur - 0.1; x += 0.045) {
        const depth = Math.min(1, (x - 0.25) / 0.6) * 260;
        events.push({
          t: t + x,
          type: "bend",
          ch,
          value: Math.round(8192 + depth * Math.sin(2 * Math.PI * 5.2 * x)),
        });
      }
      events.push({ t: t + dur, type: "bend", ch, value: 8192 });
    };
    let tt = 0.3;
    let chorus = 0;
    // Giris: tek basina slide gitar, iki olcu
    const intro = [7, 10, 12].map((iv) => fit(root + 52 + iv, 64, 79));
    intro.forEach((n, i) => {
      const at = tt + i * beat * 1.3;
      bendTo(CH.violin, at - 0.01, -1, 0.18);
      note(CH.violin, n, at, beat * 1.2, 66);
    });
    note(CH.violin, fit(root + 52, 64, 76), tt + beat * 4, bar * 1.2, 70);
    vibrato(CH.violin, tt + beat * 4, bar * 1.2);
    tt += bar * 2;
    const chorusLen = bar * 12;
    /** Bir koru (ya da vamp) calar: ritim, bas, org, davul ve istenirse slide solo. */
    const playForm = (form: number[], quiet: boolean, lead: boolean) => {
      for (let b = 0; b < form.length; b++) {
        const c = root + form[b];
        const dyn = quiet ? 0.75 : 1;
        // Ritim gitar: boogie (kok-besli / kok-alti), uzun-kisa shuffle
        for (let k = 0; k < 4; k++) {
          const top = k % 2 === 0 ? 7 : 9;
          const lowN = fit(c + 40, 40, 51);
          const at = tt + k * beat;
          note(CH.piano, lowN, at + jitter(), t3 * 2 * 0.9, 46 * dyn);
          note(CH.piano, lowN + top, at + jitter(), t3 * 2 * 0.9, 40 * dyn);
          note(CH.piano, lowN, at + t3 * 2 + jitter(), t3 * 0.9, 34 * dyn);
          note(CH.piano, lowN + top, at + t3 * 2 + jitter(), t3 * 0.9, 30 * dyn);
        }
        // Bas: kok-besli-oktav-besli, shuffle
        [0, 7, 12, 7].forEach((iv, k) =>
          note(CH.bass, fit(c + 28 + iv, 28, 52), tt + k * beat, beat * 0.9, 58 * dyn),
        );
        // Org: akor zemini (sakin korusta da)
        if (b === 0 || form[b] !== form[b - 1])
          for (const iv of [0, 3, 7, 10]) {
            const idx = form.slice(b).findIndex((x) => x !== form[b]);
            const len = (idx === -1 ? form.length - b : idx) * bar;
            note(CH.pad, fit(c + 52 + iv, 52, 70), tt, Math.max(bar, len) * 0.98, 40);
          }
        // Davul: firca hissi — kick 1-3, yumusak trampet 2-4, uclu hi-hat
        if (!quiet) {
          for (let k = 0; k < 4; k++) {
            const at = tt + k * beat;
            if (k % 2 === 0) note(DR, 36, at, 0.2, 54);
            else note(DR, 38, at + 0.01, 0.2, 40);
            note(DR, 42, at, 0.1, 26);
            note(DR, 42, at + t3 * 2, 0.1, 18);
          }
          if (b === form.length - 1) note(DR, 51, tt + beat * 3, 0.5, 30);
        }
        // Slide solo: cagri olculeri (1-2, 5-6, 9-10), arada nefes
        if (lead && b % 4 < 2) {
          const first = b % 4 === 0;
          const rhythm = first
            ? pick([
                [0, 2.5],
                [0.66, 2],
                [0, 1, 2],
              ])
            : pick([[0, 1.66], [1], [0, 2]]);
          rhythm.forEach((pos, i) => {
            const at = tt + pos * beat;
            const last = i === rhythm.length - 1 && !first;
            const deg = last ? pick([0, 7]) : pick(PENT);
            const n = fit(c + 64 + deg, 64, 81);
            const len = last ? bar * 1.6 : beat * (pick([0.9, 1.3, 1.6]) as number);
            bendTo(CH.violin, at - 0.015, pick([-1, -0.5, -2]), pick([0.12, 0.18, 0.25]));
            note(CH.violin, n, at, len, (last ? 78 : 70) * dyn);
            if (len > beat * 1.2) vibrato(CH.violin, at, len);
          });
        }
        tt += bar;
      }
    };
    // Korular: sure dolana kadar; kalan sure i akorunda vamp ile doldurulur (sessizlik kalmaz)
    while (tt + chorusLen < durationSec - bar * 2) {
      const quiet = chorus % 4 === 3; // her 4 korusta bir sakin koru (davulsuz)
      playForm(FORM, quiet, chorus % 2 === 1 || quiet);
      chorus++;
    }
    const vampBars = Math.floor((durationSec - bar * 2 - tt) / bar);
    if (vampBars > 0)
      playForm(
        Array.from({ length: vampBars }, () => 0),
        true,
        true,
      );
    // Kapanis: i akoru, gitar vibratolu kok
    for (const iv of [0, 7, 12, 15]) note(CH.piano, fit(root + 40 + iv, 40, 60), tt, bar * 1.5, 50);
    note(CH.bass, fit(root + 28, 28, 40), tt, bar * 1.5, 60);
    note(CH.violin, fit(root + 64, 64, 76), tt + 0.05, bar * 1.6, 74);
    vibrato(CH.violin, tt + 0.05, bar * 1.6);
    note(DR, 49, tt, 2, 40);
    events.sort((a, b) => a.t - b.t || order(a) - order(b));
    return {
      events,
      tempo,
      description: `${MUSIC_STYLES[style].label}, ${tempo} BPM, ${chorus} koru (${["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"][root]} minör)`,
    };
  }

  // --- Kece piyano + yagmur icin: 4–8 sn'de bir tek nota ya da iki notali kisa motif ---
  if (style === "felt_piano") {
    const key = new Key(pick(spec.roots), pick(spec.modes));
    const prog = pick(PROGRESSIONS[key.mode]);
    events.push({ t: 0, type: "cc", ch: CH.piano, cc: 64, value: 127 });
    let tt = 1;
    let ci = 0;
    let chordEnd = 0;
    let deg = prog[0];
    let lastNote = -1;
    let gaps = 0;
    const fit = (n: number) => {
      while (n > 69) n -= 12;
      while (n < 50) n += 12;
      return n;
    };
    while (tt < durationSec - 9) {
      if (tt >= chordEnd) {
        deg = prog[ci++ % prog.length];
        chordEnd = tt + between(30, 45);
        // Pedal yenile: onceki akorun yankisi yeni akora karismasin
        events.push({ t: Math.max(0, tt - 0.08), type: "cc", ch: CH.piano, cc: 64, value: 0 });
        events.push({ t: tt + 0.04, type: "cc", ch: CH.piano, cc: 64, value: 127 });
        const low = key.note(deg, 36);
        note(CH.piano, low > 47 ? low - 12 : low, tt, 10, 30);
        tt += between(1.5, 3);
      }
      // Melodi kurmadan: akor notalarindan (ara sira 9. derece) rastgele, alt-orta oktav
      const tones = [...key.triad(deg), ...(r() < 0.25 ? [deg + 1] : [])];
      const octave = r() < 0.6 ? 48 : 60;
      let n1 = fit(key.note(pick(tones), octave));
      if (n1 === lastNote) n1 = fit(key.note(pick(tones), octave === 48 ? 60 : 48));
      note(CH.piano, n1, tt + jitter(), 7, between(28, 36));
      lastNote = n1;
      if (r() < 0.4) {
        const n2 = fit(key.note(pick(tones), octave));
        if (n2 !== n1) {
          note(CH.piano, n2, tt + between(0.8, 1.6), 7, between(24, 32));
          lastNote = n2;
        }
      }
      const long = r() < 0.25;
      if (long) gaps++;
      tt += long ? between(9, 15) : between(4, 8);
    }
    events.sort((a, b) => a.t - b.t || order(a) - order(b));
    return {
      events,
      tempo,
      description: `${MUSIC_STYLES[style].label}: ${["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"][key.root]} ${key.mode}, 4–8 sn aralık, ${gaps} uzun boşluk`,
    };
  }

  // --- Davulsuz lo-fi: ritim akorlarin calinisindan, gevsek ve hafif swing ---
  if (style === "lofi") {
    let key = new Key(pick(spec.roots), pick(spec.modes));
    const LOFI_PROGS = [
      [1, 4, 0, 5],
      [0, 5, 1, 4],
      [3, 2, 1, 0],
      [0, 3, 2, 5],
      [5, 1, 4, 0],
    ];
    const swing = beat * 0.14;
    const at = (bt: number) => (bt % 1 === 0.5 ? bt * beat + swing : bt * beat);
    const fitV = (n: number) => {
      while (n > 70) n -= 12;
      while (n < 52) n += 12;
      return n;
    };
    const PATTERNS: [number, number, boolean][][] = [
      [
        [0, 1.4, true],
        [1.5, 1.2, false],
      ],
      [
        [0, 2.4, true],
        [2.5, 1.3, false],
      ],
      [[0, 3.7, true]],
      [
        [0, 1.4, true],
        [2, 0.9, false],
        [3.5, 0.5, false],
      ],
    ];
    const pent = [0, 1, 2, 4, 5];
    let tt = 0.3;
    let section = 0;
    while (tt < durationSec - bar * 2) {
      if (section > 0 && section % 3 === 0) key = new Key((key.root + 5) % 12, key.mode);
      const prog = pick(LOFI_PROGS);
      for (let b = 0; b < 16 && tt < durationSec - bar * 2; b++) {
        const d = prog[b % 4];
        const voicing = [d + 2, d + 4, d + 6, ...(r() < 0.5 ? [d + 8] : [])].map((x) =>
          fitV(key.note(x, 48)),
        );
        voicing.sort((x, y) => x - y);
        const pat = pick(PATTERNS);
        for (const [pos, len, full] of pat) {
          const notes = full ? voicing : voicing.slice(-2);
          const start = tt + at(pos) + jitter() * 1.5;
          notes.forEach((n, i) =>
            note(
              CH.piano,
              n,
              start + i * between(0.012, 0.03),
              len * beat,
              (full ? 46 : 36) - i * 2,
            ),
          );
        }
        // Bas: birinci vurusta kok, bazen ucuncu vurustan once besli
        note(CH.bass, key.note(d, 36), tt + jitter(), beat * 1.8, 46);
        if (r() < 0.5) note(CH.bass, key.note(d + 4, 36), tt + at(2.5), beat, 36);
        // Seyrek, sakin ust ezgi
        if (b % 2 === 1 && r() < 0.45) {
          let pos = pick([0.5, 1, 1.5]);
          for (let k = 0; k < 2 + Math.floor(r() * 3) && pos < 4; k++) {
            const n = key.note(d + pick(pent), 72);
            note(
              CH.piano,
              n > 81 ? n - 12 : n,
              tt + at(pos) + jitter(),
              beat * between(0.6, 1.2),
              34,
            );
            pos += pick([0.5, 1, 1]);
          }
        }
        tt += bar;
      }
      section++;
    }
    const endT = Math.min(tt, durationSec - 7);
    if (endT > 0)
      [0, 2, 4, 6].forEach((x, i) => note(CH.piano, fitV(key.note(x, 48)), endT + i * 0.03, 6, 40));
    events.sort((a, b) => a.t - b.t || order(a) - order(b));
    return {
      events,
      tempo,
      description: `${MUSIC_STYLES[style].label}, ${tempo} BPM, ${section} bölüm, davulsuz`,
    };
  }

  let t = 0.2;
  let movement = 0;
  let key = new Key(pick(spec.roots), pick(spec.modes));
  const movementsInfo: string[] = [];

  while (t < durationSec - bar) {
    // Her bolumde yeni dizi ve motif; zaman zaman ilgili tonaliteye gecis
    if (movement > 0 && r() < 0.5) {
      const shift = pick([5, 7, 3, -3]);
      key = new Key(
        (key.root + shift + 12) % 12,
        key.mode === "ionian" && r() < 0.3 ? "aeolian" : key.mode,
      );
    }
    const prog = pick(PROGRESSIONS[key.mode]);
    const bpc = pick(spec.barsPerChord);
    const cycles = style === "nordic" || style === "strings" || style === "deep_sleep" ? 3 : 4;
    const chords: number[] = [];
    for (let c = 0; c < cycles; c++)
      for (const d of prog) for (let b = 0; b < bpc; b++) chords.push(d);
    const nBars = chords.length;
    movementsInfo.push(
      `${["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"][key.root]} ${key.mode}`,
    );

    // Motif: 2 olcu ritim + derece hareketi
    const rhythms =
      style === "piano"
        ? [
            [2, 1, 1],
            [1, 1, 2],
            [3, 1],
            [2, 2],
            [1.5, 0.5, 2],
          ]
        : [[4], [2, 2], [3, 1], [2, 1, 1], [1, 1, 2]];
    const motif = [pick(rhythms), pick(rhythms)];
    const motifSteps = motif.flat().map(() => pick([-1, -1, 1, 1, 0, 2, -2]));

    let melodyDeg = 4 + Math.floor(r() * 3);
    let last1 = -99;
    let last2 = -98;
    for (let b = 0; b < nBars && t < durationSec - bar; b++) {
      const deg = chords[b];
      const triad = key.triad(deg);
      const section = b < 2 ? "intro" : b >= nBars - 2 ? "outro" : "main";
      const dyn = section === "intro" ? 0.75 : section === "outro" ? 0.7 : 1;
      const chordStart = b === 0 || chords[b - 1] !== deg;

      // --- Eslik ---
      if (style === "piano" || style === "piano_violin") {
        if (chordStart) {
          events.push({ t: Math.max(0, t - 0.03), type: "cc", ch: CH.piano, cc: 64, value: 0 });
          events.push({ t: t + 0.02, type: "cc", ch: CH.piano, cc: 64, value: 110 });
        }
        const bass = key.note(deg, 36);
        note(CH.piano, bass, t + jitter(), bar * 0.95, (style === "piano" ? 40 : 46) * dyn);
        const arp = [
          key.note(deg, 48),
          key.note(triad[1], 48),
          key.note(triad[2], 48),
          key.note(deg + 7, 48),
        ];
        const pattern = [0, 1, 2, 3, 2, 1, 2, 3];
        const step = beat / 2;
        pattern.forEach((p, i) => {
          if ((style === "piano_violin" || style === "piano") && i % 2 === 1 && r() < 0.5) return;
          note(
            CH.piano,
            arp[p],
            t + i * step + jitter(),
            step * 1.9,
            (style === "piano" ? 32 : 32) * dyn,
          );
        });
      }
      // Romantik piyano (piano_violin): keman kaldirildi (kullanici: cok tiz); yalniz piyano
      if (style === "strings") {
        if (chordStart) {
          const len =
            bar *
            (chords.slice(b).findIndex((x) => x !== deg) === -1
              ? 1
              : Math.max(
                  1,
                  chords.slice(b).findIndex((x) => x !== deg),
                ));
          for (const d of triad)
            note(
              CH.strings,
              key.note(d, 60),
              t,
              len * 0.98,
              (style === "strings" ? 70 : 48) * dyn,
              true,
            );
          if (style === "strings") note(CH.bass, key.note(deg, 36), t, len * 0.98, 62 * dyn, true);
        }
      }
      if (style === "deep_sleep" && chordStart) {
        // Sicak pad + cok hafif koro, orta register (her hoparlorde duyulur); bas yumusak
        const len = bar * bpc;
        for (const d of triad) note(CH.pad, key.note(d, 60), t, len * 0.99, 62 * dyn, true);
        if (section !== "intro")
          for (const d of triad)
            note(CH.choir, key.note(d, 60), t + 0.3, len * 0.97, 34 * dyn, true);
        note(CH.bass, key.note(deg, 48), t, len * 0.99, 28, true);
      }
      if (style === "nordic") {
        if (chordStart) {
          const len = bar * bpc;
          // Bordun: kontrbas tonik + cello besli; koro akorlari
          note(CH.bass, key.note(0, 24), t, len * 0.99, 66, true);
          note(CH.cello, key.note(4, 36), t, len * 0.99, 58, true);
          if (section !== "intro")
            for (const d of triad)
              note(CH.choir, key.note(d, 60), t + 0.05, len * 0.97, 52 * dyn, true);
        }
        // Davul: kalp atisi gibi agir vuruslar
        if (section !== "intro" && !(section === "outro" && b === nBars - 1)) {
          const low = key.note(0, 36);
          note(CH.drum, low, t + jitter(), beat, 58 * dyn);
          note(CH.drum, low, t + beat * 2 + jitter(), beat, 46 * dyn);
          if (r() < 0.45) note(CH.drum, low, t + beat * 3.5 + jitter(), beat * 0.5, 38 * dyn);
        }
        if (section === "main" && chordStart && r() < 0.35)
          note(CH.horn, key.note(deg, 48), t + beat, bar * 1.5, 50, true);
      }

      // --- Melodi ---
      const melodyCh =
        style === "piano" || style === "deep_sleep" || style === "piano_violin"
          ? CH.piano
          : style === "strings"
            ? CH.cello
            : CH.violin;
      const base =
        style === "piano" || style === "piano_violin"
          ? 60
          : style === "strings"
            ? 48
            : style === "nordic"
              ? 60
              : style === "deep_sleep"
                ? 72
                : 72;
      // Derin uykuda melodi seyrek: her olcude degil, yumusak ve az nota
      const playMelody =
        (section === "main" || (section === "outro" && b === nBars - 2)) &&
        !(style === "deep_sleep" && r() < 0.45);
      if (playMelody && !(style === "nordic" && r() < 0.15)) {
        const varied = r() < 0.3;
        const rhythm = varied ? pick(rhythms) : motif[b % 2];
        let tt = t;
        rhythm.forEach((dur, i) => {
          const idx = (b % 2) * motif[0].length + i;
          melodyDeg += varied ? pick([-1, 1, 0, 2, -2]) : (motifSteps[idx] ?? 0);
          // Guclu vurusta akor notasina yaklas
          if (i === 0) {
            const targets = triad.flatMap((d) => [d, d + 7]);
            const prev = melodyDeg;
            const sorted = [...targets].sort((x, y) => Math.abs(x - prev) - Math.abs(y - prev));
            // Cogunlukla en yakin akor notasi, bazen ikinci en yakin (cesitlilik)
            melodyDeg = sorted[r() < 0.7 || sorted[0] !== prev ? 0 : 1];
          }
          // Ust/alt sinira yaklasinca geri yansit: melodi bir notada takilip kalmasin
          if (melodyDeg > 10) melodyDeg -= 2 + Math.floor(r() * 2);
          if (melodyDeg < 3) melodyDeg += 2 + Math.floor(r() * 2);
          // Ayni nota ust uste ucuncu kez gelmesin
          if (melodyDeg === last1 && last1 === last2) melodyDeg += r() < 0.5 ? -1 : 1;
          last2 = last1;
          last1 = melodyDeg;
          const isLast = section === "outro" && i === rhythm.length - 1;
          const n = key.note(isLast ? 7 : melodyDeg, base);
          // Ayni nota tekrarinda onceki nota yenisini susturmasin diye kisa bosluk
          const d = dur * beat * 0.97;
          note(
            melodyCh,
            n,
            tt + (melodyCh === CH.piano ? jitter() : 0),
            isLast ? bar * 1.5 : d,
            (style === "deep_sleep" ? 34 : melodyCh === CH.piano ? 46 : 64) * dyn,
            melodyCh !== CH.piano,
          );
          tt += dur * beat;
        });
      }
      t += bar;
    }
    // Nefes: bolumler arasinda kisa sessizlige yakin gecis
    t += bar * (style === "piano" ? 0.5 : 1);
    movement++;
  }
  // Son: tonik akor uzun
  const endT = Math.min(t, durationSec - 6);
  if (endT > 0)
    for (const d of key.triad(0))
      note(
        style === "piano" || style === "piano_violin" ? CH.piano : CH.strings,
        key.note(d, 60),
        endT,
        5,
        40,
        style !== "piano" && style !== "piano_violin",
      );

  events.sort((a, b) => a.t - b.t || order(a) - order(b));
  return {
    events,
    tempo,
    description: `${MUSIC_STYLES[style].label}, ${tempo} BPM, ${movement} bölüm (${[...new Set(movementsInfo)].slice(0, 4).join(", ")})`,
  };
}

/** Ayni anda: once program/cc, sonra note-off, sonra note-on. */
function order(e: MusicEvent) {
  return e.type === "program"
    ? 0
    : e.type === "cc" || e.type === "bend"
      ? 1
      : e.type === "off"
        ? 2
        : 3;
}
