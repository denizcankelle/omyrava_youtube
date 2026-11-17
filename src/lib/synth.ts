/**
 * Yerlesik ses uretimi (yapay zekasiz, FFmpeg sentezi). Her uretim bir "seed" ile
 * belirlenir: ayni seed ayni sesi, farkli seed farkli sesi verir.
 */
import { z } from "zod";

export const SYNTH_PRESETS = {
  rain_light: { label: "Yağmur — hafif", tonal: false },
  rain_heavy: { label: "Yağmur — yoğun", tonal: false },
  waves: { label: "Okyanus dalgaları", tonal: false },
  brown_noise: { label: "Kahverengi gürültü", tonal: false },
  pink_noise: { label: "Pembe gürültü", tonal: false },
  wind: { label: "Rüzgâr (kuzey)", tonal: false },
  drone: { label: "Yumuşak drone (Cosmic)", tonal: true },
  pad: { label: "Yumuşak pad akorları (Meditation)", tonal: true },
  rain_glass: { label: "Camın arkasından ince yağmur", tonal: false },
  waves_soft: { label: "Uzak, küçük dalgalar", tonal: false },
  ambient_warm: { label: "Kadife sıcak ambient (30–60 sn akor)", tonal: true },
  deep_ambient: { label: "Derin ambient (karışan 3 ses)", tonal: true },
  vinyl_hiss: { label: "Plak dokusu (çıtırtısız, çok hafif)", tonal: false },
} as const;

export type SynthPreset = keyof typeof SYNTH_PRESETS;

export const synthSchema = z.object({
  projectId: z.string().min(1),
  preset: z.enum(Object.keys(SYNTH_PRESETS) as [SynthPreset, ...SynthPreset[]]),
  minutes: z.coerce.number().int().min(1).max(120),
  count: z.coerce.number().int().min(1).max(5).default(1),
});

/** Kucuk, deterministik PRNG (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
const f3 = (x: number) => x.toFixed(3);
const pick = <T>(r: () => number, arr: readonly T[]): T => arr[Math.floor(r() * arr.length)];
const between = (r: () => number, a: number, b: number) => a + r() * (b - a);

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export const noteName = (midi: number) => `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;

const PROGRESSIONS = [
  {
    name: "majör I–vi–IV",
    chords: [
      [0, 4, 7],
      [-3, 0, 4],
      [-7, -3, 0],
    ],
  },
  {
    name: "majör I–IV–V",
    chords: [
      [0, 4, 7],
      [-7, -3, 0],
      [-5, -1, 2],
    ],
  },
  {
    name: "minör i–VI–III",
    chords: [
      [0, 3, 7],
      [-4, 0, 3],
      [3, 7, 10],
    ],
  },
  {
    name: "minör i–VII–VI",
    chords: [
      [0, 3, 7],
      [-2, 2, 5],
      [-4, 0, 3],
    ],
  },
] as const;

export interface SynthPlan {
  preset: SynthPreset;
  seed: number;
  durationSec: number;
  /** ffmpeg arguman listesi (cikti dosyasi en sonda). */
  args: string[];
  description: string;
}

/** Kanal basina ses ifadesi (aevalsrc). */
function padExpr(r: () => number, detune: number) {
  const root = pick(r, [45, 47, 48, 50, 52, 53, 55]);
  const prog = pick(r, PROGRESSIONS);
  const period = Math.round(between(r, 45, 90));
  const terms: string[] = [];
  prog.chords.forEach((chord, k) => {
    const env = `0.5*(1-cos(2*PI*t/${period}-${f3((2 * Math.PI * k) / prog.chords.length)}))`;
    for (const iv of chord) {
      const f = hz(root + iv) * detune;
      terms.push(`${env}*(sin(2*PI*${f3(f)}*t)+0.15*sin(4*PI*${f3(f)}*t))`);
    }
  });
  return {
    expr: `0.06*(${terms.join("+")})`,
    info: `${noteName(root)} ${prog.name}, ${period} sn döngü`,
  };
}

function droneExpr(r: () => number, detune: number) {
  // Kok A2..E3: telefon/dizustu hoparlorlerinde de duyulur (eskiden A1..G2 idi, cok derin)
  const root = pick(r, [45, 47, 48, 50, 52]);
  const voices = [0, 7, 12, 16, 19].map((iv, i) => {
    const f = hz(root + iv) * detune;
    const lfo = Math.round(between(r, 23, 71));
    const depth = i === 0 ? 0.15 : 0.5;
    const amp = [1, 0.7, 0.5, 0.3, 0.25][i];
    // Hafif 2. harmonik: sicaklik ve duyulabilirlik
    return `(${1 - depth}+${depth}*sin(2*PI*t/${lfo}+${f3(r() * 6.28)}))*${amp}*(sin(2*PI*${f3(f)}*t)+0.2*sin(4*PI*${f3(f)}*t))`;
  });
  return {
    expr: `0.08*(${voices.join("+")})`,
    info: `${noteName(root)} kök, beşli + oktav + üçlü`,
  };
}

/** 4 akorlu, acik dizilisli (genis aralikli) sicak ilerlemeler; kok'e gore yarim ton. */
const AMBIENT_PROGS = [
  {
    name: "majör I–iii–vi–IV",
    chords: [
      [0, 7, 16],
      [4, 11, 19],
      [-3, 7, 12],
      [-7, 0, 9],
    ],
  },
  {
    name: "majör I–IV–vi–IV",
    chords: [
      [0, 7, 16],
      [-7, 0, 9],
      [-3, 7, 12],
      [-7, 0, 9],
    ],
  },
  {
    name: "minör i–VI–III–VII",
    chords: [
      [0, 7, 15],
      [-4, 3, 12],
      [3, 10, 19],
      [-2, 5, 14],
    ],
  },
  {
    name: "minör i–iv–VI–i",
    chords: [
      [0, 7, 15],
      [-7, 0, 8],
      [-4, 3, 12],
      [0, 7, 15],
    ],
  },
] as const;

/**
 * Kadife ambient: 4 akor, her biri `C` saniye (30–60) baskin. Akor agirliklari
 * (0.5(1+cos))^3: toplam yaklasik sabit kalir, gecisler C saniyeye yayilir.
 * Her ses iki hafif kaydirilmis kopya (sicak dalgalanma), cok az ust harmonik.
 */
function warmPadExpr(r: () => number, detune: number) {
  const root = pick(r, [45, 46, 47, 48, 50, 52]);
  const prog = pick(r, AMBIENT_PROGS);
  const C = Math.round(between(r, 32, 56));
  const P = C * prog.chords.length;
  const terms: string[] = [];
  prog.chords.forEach((chord, k) => {
    const w = `pow(0.5*(1+cos(2*PI*(t/${P}-${f3(k / prog.chords.length)}))),3)`;
    chord.forEach((iv, j) => {
      const f = hz(root + iv) * detune;
      const amp = [1, 0.75, 0.55][j];
      terms.push(
        `${w}*${amp}*(sin(2*PI*${f3(f)}*t)+0.35*sin(2*PI*${f3(f * 1.003)}*t)+0.12*sin(4*PI*${f3(f)}*t))`,
      );
    });
  });
  return {
    expr: `0.05*(${terms.join("+")})`,
    info: `${noteName(root)} ${prog.name}, akor başına ${C} sn`,
  };
}

/**
 * Derin ambient: melodi yok. Sabit, nefes alan bir alt ses + 3 ses; her biri 15–30 sn'de
 * yukselip kaybolur (sin^2 zarfi). Ses sifirdayken notasini pentatonik havuzdan degistirir,
 * bu yuzden tik/klik olusmaz. Seslerin zarflari kaydirilmis: hep 2–3 ses birbirine karisir.
 */
function deepAmbientExpr(r: () => number, detune: number) {
  const root = pick(r, [40, 41, 42, 43, 44, 45, 46, 47]);
  const minor = r() < 0.5;
  const pent = minor ? [0, 3, 5, 7, 10] : [0, 2, 4, 7, 9];
  const poolIn = (lo: number, hi: number) => {
    const out: number[] = [];
    for (let m = lo; m <= hi; m++) if (pent.includes(((m % 12) + 12) % 12)) out.push(m);
    return out;
  };
  const ranges: [number, number][] = [
    [12, 19],
    [17, 26],
    [22, 31],
  ];
  // Ayni periyot, 1/3 kaydirma: sin^2 zarflarinin toplami sabit -> genel ses seviyesi dalgalanmaz,
  // yalnizca hangi notalarin duyuldugu yavasca degisir.
  const T = Math.round(between(r, 36, 56));
  const voices = ranges.map(([lo, hi], i) => {
    const pool = poolIn(lo, hi);
    const o = f3((T * i) / 3);
    const k = pick(r, [2, 3]);
    const c = Math.floor(r() * pool.length);
    const x = `((t+${o})/${T})`;
    const idx = `mod(floor(${x})*${k}+floor(${x}/${pool.length})+${c},${pool.length})`;
    let F = f3(hz(root + pool[pool.length - 1]) * detune);
    for (let j = pool.length - 2; j >= 0; j--)
      F = `if(eq(${idx},${j}),${f3(hz(root + pool[j]) * detune)},${F})`;
    const env = `pow(sin(PI*${x}),2)`;
    const amp = [1, 0.9, 0.8][i];
    return `${amp}*${env}*(sin(2*PI*(${F})*t)+0.3*sin(4*PI*(${F})*t)+0.08*sin(6*PI*(${F})*t))`;
  });
  const sub = hz(root) * detune;
  const L = Math.round(between(r, 41, 67));
  const subExpr = `0.55*(0.8+0.2*sin(2*PI*t/${L}))*(sin(2*PI*${f3(sub)}*t)+0.25*sin(4*PI*${f3(sub)}*t))`;
  return {
    expr: `0.1*(${subExpr}+${voices.join("+")})`,
    info: `${noteName(root)} ${minor ? "minör" : "majör"} pentatonik, 3 ses ${Math.round(T / 2)} sn'de yükselip kaybolur`,
  };
}

/** Uretim plani: ffmpeg komutu ve aciklama. */
export function buildSynthPlan(
  preset: SynthPreset,
  seed: number,
  durationSec: number,
  output: string,
): SynthPlan {
  const r = rng(seed);
  const d = String(Math.round(durationSec));
  const s = (n: number) => (seed * 7 + n) % 2147483647;
  const base = ["-y"];
  const tail = ["-t", d, "-ar", "48000", "-c:a", "flac", output];
  let args: string[];
  let description: string;

  switch (preset) {
    case "rain_light":
    case "rain_heavy": {
      const heavy = preset === "rain_heavy";
      const P = Math.round(between(r, 31, 79));
      const hp = heavy ? 250 : Math.round(between(r, 450, 700));
      const lp = heavy ? 7000 : Math.round(between(r, 8000, 11000));
      const rumble = heavy ? 0.9 : f3(between(r, 0.3, 0.6));
      args = [
        ...base,
        "-f",
        "lavfi",
        "-i",
        `anoisesrc=c=pink:a=0.6:seed=${s(1)}:r=48000:d=${d}`,
        "-f",
        "lavfi",
        "-i",
        `anoisesrc=c=pink:a=0.6:seed=${s(2)}:r=48000:d=${d}`,
        "-f",
        "lavfi",
        "-i",
        `anoisesrc=c=brown:a=0.5:seed=${s(3)}:r=48000:d=${d}`,
        "-filter_complex",
        `[0][1]join=inputs=2:channel_layout=stereo,highpass=f=${hp},lowpass=f=${lp}[h];` +
          `[2]lowpass=f=${heavy ? 600 : 400},pan=stereo|c0=c0|c1=c0[l];` +
          `[h][l]amix=inputs=2:weights=1 ${rumble}:normalize=0,` +
          `volume='0.85+0.15*sin(2*PI*t/${P})':eval=frame[o]`,
        "-map",
        "[o]",
        ...tail,
      ];
      description = `${SYNTH_PRESETS[preset].label}: ${hp}–${lp} Hz, ${P} sn yoğunluk dalgası`;
      break;
    }
    case "waves": {
      const P1 = f3(between(r, 8, 13));
      const P2 = f3(between(r, 9, 14));
      args = [
        ...base,
        "-f",
        "lavfi",
        "-i",
        `anoisesrc=c=brown:a=0.7:seed=${s(1)}:r=48000:d=${d}`,
        "-f",
        "lavfi",
        "-i",
        `anoisesrc=c=brown:a=0.7:seed=${s(2)}:r=48000:d=${d}`,
        "-filter_complex",
        `[0]lowpass=f=1800,volume='0.2+0.8*pow(sin(PI*t/${P1}),2)':eval=frame[a];` +
          `[1]lowpass=f=1800,volume='0.2+0.8*pow(sin(PI*t/${P2}+1.3),2)':eval=frame[b];` +
          `[a][b]join=inputs=2:channel_layout=stereo[o]`,
        "-map",
        "[o]",
        ...tail,
      ];
      description = `Dalgalar: ${P1} / ${P2} sn aralık`;
      break;
    }
    case "wind": {
      const P1 = Math.round(between(r, 17, 29));
      const P2 = Math.round(between(r, 37, 61));
      const P3 = Math.round(between(r, 7, 13));
      const gust = (ph: number) =>
        `volume='0.45+0.25*sin(2*PI*t/${P1}+${ph})+0.2*sin(2*PI*t/${P2})+0.1*sin(2*PI*t/${P3})':eval=frame`;
      args = [
        ...base,
        "-f",
        "lavfi",
        "-i",
        `anoisesrc=c=brown:a=0.7:seed=${s(1)}:r=48000:d=${d}`,
        "-f",
        "lavfi",
        "-i",
        `anoisesrc=c=pink:a=0.35:seed=${s(2)}:r=48000:d=${d}`,
        "-filter_complex",
        `[0][1]amix=inputs=2:normalize=0,highpass=f=120,lowpass=f=1400,asplit=2[a][b];` +
          `[a]${gust(0)}[l];[b]${gust(1.7)}[r2];[l][r2]join=inputs=2:channel_layout=stereo[o]`,
        "-map",
        "[o]",
        ...tail,
      ];
      description = `Rüzgâr: ${P1}/${P2}/${P3} sn esinti döngüleri`;
      break;
    }
    case "brown_noise":
    case "pink_noise": {
      const c = preset === "brown_noise" ? "brown" : "pink";
      const lp = Math.round(between(r, c === "brown" ? 600 : 3000, c === "brown" ? 1200 : 6000));
      args = [
        ...base,
        "-f",
        "lavfi",
        "-i",
        `anoisesrc=c=${c}:a=0.6:seed=${s(1)}:r=48000:d=${d}`,
        "-f",
        "lavfi",
        "-i",
        `anoisesrc=c=${c}:a=0.6:seed=${s(2)}:r=48000:d=${d}`,
        "-filter_complex",
        `[0][1]join=inputs=2:channel_layout=stereo,lowpass=f=${lp}[o]`,
        "-map",
        "[o]",
        ...tail,
      ];
      description = `${SYNTH_PRESETS[preset].label}, ${lp} Hz alçak geçiren`;
      break;
    }
    case "rain_glass": {
      // Camin arkasindan: ince (alt kesik), donuk (ust kesik), cok esit; tek damla yok.
      const P = Math.round(between(r, 53, 97));
      const hp = Math.round(between(r, 380, 520));
      const lp = Math.round(between(r, 5200, 6500));
      args = [
        ...base,
        "-f",
        "lavfi",
        "-i",
        `anoisesrc=c=pink:a=0.6:seed=${s(1)}:r=48000:d=${d}`,
        "-f",
        "lavfi",
        "-i",
        `anoisesrc=c=pink:a=0.6:seed=${s(2)}:r=48000:d=${d}`,
        "-f",
        "lavfi",
        "-i",
        `anoisesrc=c=brown:a=0.5:seed=${s(3)}:r=48000:d=${d}`,
        "-filter_complex",
        `[0][1]join=inputs=2:channel_layout=stereo,highpass=f=${hp}:p=2,lowpass=f=${lp}:p=2,` +
          `equalizer=f=3000:t=q:w=1:g=-3[h];` +
          `[2]lowpass=f=350,pan=stereo|c0=c0|c1=c0[l];` +
          `[h][l]amix=inputs=2:weights=1 0.25:normalize=0,` +
          `volume='0.95+0.05*sin(2*PI*t/${P})':eval=frame[o]`,
        "-map",
        "[o]",
        ...tail,
      ];
      description = `${SYNTH_PRESETS[preset].label}: ${hp}–${lp} Hz, ±%5 yoğunluk (${P} sn)`;
      break;
    }
    case "waves_soft": {
      // Dalga araligi 8–15 sn arasinda dogal olarak degisir: faz hizi iki yavas sinusle oynar.
      // Zarf sin^2: gelis ve cekilis yumusak, kirilma aninda ani yukselme yok.
      const M = between(r, 10.2, 10.6);
      const A = 0.018;
      const B = 0.008;
      const Q1 = Math.round(between(r, 83, 113));
      const Q2 = Math.round(between(r, 37, 53));
      const phi = (off: number) =>
        `(t/${f3(M)}-${f3((A * Q1) / (2 * Math.PI))}*cos(2*PI*t/${Q1})-${f3((B * Q2) / (2 * Math.PI))}*cos(2*PI*t/${Q2})+${f3(off)})`;
      const body = (off: number) => `volume='0.3+0.7*pow(sin(PI*${phi(off)}),2)':eval=frame`;
      // Kopuk: govdeden biraz sonra, daha dar zarf ve cok hafif (sert "kssh" yok)
      const foam = (off: number) => `volume='0.18*pow(sin(PI*${phi(off - 0.08)}),4)':eval=frame`;
      args = [
        ...base,
        "-f",
        "lavfi",
        "-i",
        `anoisesrc=c=brown:a=0.7:seed=${s(1)}:r=48000:d=${d}`,
        "-f",
        "lavfi",
        "-i",
        `anoisesrc=c=brown:a=0.7:seed=${s(2)}:r=48000:d=${d}`,
        "-f",
        "lavfi",
        "-i",
        `anoisesrc=c=pink:a=0.5:seed=${s(3)}:r=48000:d=${d}`,
        "-f",
        "lavfi",
        "-i",
        `anoisesrc=c=pink:a=0.5:seed=${s(4)}:r=48000:d=${d}`,
        "-filter_complex",
        `[0]highpass=f=60,lowpass=f=1100,${body(0)}[a];` +
          `[1]highpass=f=60,lowpass=f=1100,${body(0.06)}[b];` +
          `[2]highpass=f=900,lowpass=f=3800,${foam(0)}[fa];` +
          `[3]highpass=f=900,lowpass=f=3800,${foam(0.06)}[fb];` +
          `[a][fa]amix=inputs=2:normalize=0[l];[b][fb]amix=inputs=2:normalize=0[rr];` +
          `[l][rr]join=inputs=2:channel_layout=stereo[o]`,
        "-map",
        "[o]",
        ...tail,
      ];
      description = `${SYNTH_PRESETS[preset].label}: ort. ${M.toFixed(1)} sn, 8–15 sn arası doğal aralık`;
      break;
    }
    case "vinyl_hiss": {
      // Plak/teyp dokusu: yalnizca yumusak hisirti + cok alcak gurultu; tekil patlama yok.
      args = [
        ...base,
        "-f",
        "lavfi",
        "-i",
        `anoisesrc=c=pink:a=0.5:seed=${s(1)}:r=48000:d=${d}`,
        "-f",
        "lavfi",
        "-i",
        `anoisesrc=c=brown:a=0.5:seed=${s(2)}:r=48000:d=${d}`,
        "-filter_complex",
        `[0]highpass=f=1500,lowpass=f=6500,pan=stereo|c0=c0|c1=c0[h];` +
          `[1]lowpass=f=180,pan=stereo|c0=c0|c1=c0[l];` +
          `[h][l]amix=inputs=2:weights=1 0.6:normalize=0[o]`,
        "-map",
        "[o]",
        ...tail,
      ];
      description = SYNTH_PRESETS[preset].label;
      break;
    }
    case "ambient_warm":
    case "deep_ambient": {
      const make = preset === "ambient_warm" ? warmPadExpr : deepAmbientExpr;
      const left = make(rng(seed), 1);
      const right = make(rng(seed), 1.002);
      const fx =
        preset === "ambient_warm"
          ? "aecho=0.8:0.7:240|480|730:0.3|0.22|0.15,lowpass=f=1800:p=2,highpass=f=45,aresample=48000"
          : "aecho=0.8:0.75:310|620|930:0.32|0.24|0.16,lowpass=f=1300:p=2,highpass=f=38,equalizer=f=160:t=q:w=1:g=-2,aresample=48000";
      args = [
        ...base,
        "-f",
        "lavfi",
        "-i",
        `aevalsrc='${left.expr}|${right.expr}':s=16000:d=${d}`,
        "-af",
        fx,
        ...tail,
      ];
      description = `${SYNTH_PRESETS[preset].label}: ${left.info}`;
      break;
    }
    case "drone":
    case "pad": {
      const make = preset === "pad" ? padExpr : droneExpr;
      // Sol ve sag kanal ayni plandan, sagda hafif ince ayar farki (genislik hissi).
      const left = make(rng(seed), 1);
      const right = make(rng(seed), 1.0015);
      const fx =
        preset === "pad"
          ? "aecho=0.8:0.6:180|370:0.35|0.25,lowpass=f=3500"
          : "aecho=0.8:0.6:250|510:0.3|0.2,lowpass=f=2400";
      args = [
        ...base,
        "-f",
        "lavfi",
        "-i",
        `aevalsrc='${left.expr}|${right.expr}':s=48000:d=${d}`,
        "-af",
        fx,
        ...tail,
      ];
      description = `${SYNTH_PRESETS[preset].label}: ${left.info}`;
      break;
    }
  }
  return { preset, seed, durationSec, args, description };
}

/** Olcume gore dogrusal kazanc (dB): hedef LUFS'a cik/in ama tepe -2 dBTP'yi gecme. */
export function gainToTarget(inputI: number, inputTp: number, targetI = -18, maxTp = -2): number {
  const g = Math.min(targetI - inputI, maxTp - inputTp);
  return Math.round(g * 100) / 100;
}
