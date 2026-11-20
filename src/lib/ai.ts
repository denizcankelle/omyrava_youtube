/**
 * Yerel yapay zeka muzigi (Stable Audio 3). Durum dosyasi, istem (prompt) bankasi ve
 * uzun parcalar icin bolum plani.
 */
import fs from "node:fs";
import path from "node:path";
import { rng } from "./synth";

export interface AiStatus {
  ready: boolean;
  model?: string;
  error?: string;
  checked_at?: string;
  check?: Record<string, unknown>;
}

export function readAiStatus(aiDir: string): AiStatus | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(aiDir, "ai-durum.json"), "utf8")) as AiStatus;
  } catch {
    return null;
  }
}

export function isAiReady(aiDir: string, aiPython: string): boolean {
  const s = readAiStatus(aiDir);
  return Boolean(s?.ready && fs.existsSync(aiPython));
}

export const AI_STYLES = {
  nordic: { label: "İskandinav / Viking (yapay zekâ)" },
  piano: { label: "Solo piyano (yapay zekâ)" },
  piano_violin: { label: "Piyano ve keman (yapay zekâ)" },
  strings: { label: "Yaylılar ve çello (yapay zekâ)" },
  meditation: { label: "Meditasyon ambiyansı (yapay zekâ)" },
  deep_sleep: { label: "Derin uyku ambiyansı (yapay zekâ)" },
  cosmic: { label: "Kozmik ambiyans (yapay zekâ)" },
  lofi: { label: "Davulsuz lo-fi (yapay zekâ)" },
  dark_blues: { label: "Dark blues (yapay zekâ)" },
} as const;

export type AiStyle = keyof typeof AI_STYLES;

const BASE = "TrackType: Music, VocalType: Instrumental.";

/** Her stil icin birden fazla istem; bolumler arasinda donusumlu kullanilir (cesitlilik). */
const PROMPTS: Record<AiStyle, { prompts: string[]; negative: string; bpm: [number, number] }> = {
  nordic: {
    prompts: [
      "Cinematic Nordic dark folk, slow and hypnotic. A droning tagelharpa and low bowed lyre, deep frame drums like a calm heartbeat, ethereal wordless female vocalise floating above, distant horn. Ancient, spiritual and uplifting Viking atmosphere, stone hall reverb.",
      "Ritual Scandinavian folk instrumental: steady tribal hand drums, sustained tagelharpa drone, a haunting hardanger fiddle melody answered by an airy female choir pad, soft wind. Misty fjord at dawn, epic but calm.",
      "Meditative Norse ambient: deep drones, sparse ritual drums, a lonely nyckelharpa theme, soft harp arpeggios and wide wordless choir swells. Northern lights at night, serene and timeless.",
      "Slow epic Viking folk: heavy but soft war drums on a slow pulse, cello and tagelharpa drones, a mournful flute and fiddle melody, wordless choir rising and falling. Reverent, cinematic, grounding.",
    ],
    negative:
      "lyrics, words, rap, pop, electronic beat, synth bass, distorted guitar, metal, fast tempo, harsh, shrill",
    bpm: [60, 72],
  },
  piano: {
    prompts: [
      "Solo felt piano with a soft muffled touch, single notes and short two-note phrases in the low and middle register, long pauses between them, gentle reverb. No clear melody, minimal and calm, for sleep.",
      "Minimal felt piano ambient: sparse, round and warm notes every few seconds, soft sustain pedal, quiet dynamics, lots of space and silence between notes.",
      "Intimate muted piano, slow and minimal, a few soft low notes that ring out and fade, close and warm, very gentle, no melody, peaceful night.",
    ],
    negative:
      "drums, percussion, vocals, strings, bass, melody, fast, loud, bright, hammer, harsh, staccato, distorted",
    bpm: [50, 60],
  },
  piano_violin: {
    prompts: [
      "Neo-classical duet for piano and solo violin. Soft piano arpeggios and a gentle legato violin melody, warm hall reverb. Emotional, tender and soothing.",
      "Slow romantic piano and violin piece, the violin sings a long lyrical line while the piano plays quiet chords. Peaceful, heartfelt and calming.",
      "Cinematic but intimate piano with solo violin and a soft string pad, slow tempo, hopeful and healing atmosphere, very gentle dynamics.",
    ],
    negative: "drums, percussion, vocals, electronic, fast, loud, harsh, distorted",
    bpm: [58, 68],
  },
  strings: {
    prompts: [
      "Slow adagio for warm string orchestra and solo cello. Lush sustained chords, a deep expressive cello melody, soft dynamics. Calm, cinematic and peaceful.",
      "Gentle chamber strings, warm violas and cellos, long breathing phrases, tender and consoling mood, soft hall reverb.",
      "Ambient orchestral strings with slow swells and a solo cello theme, serene and comforting, like a quiet evening.",
    ],
    negative: "drums, percussion, vocals, brass, fast, loud, harsh, distorted",
    bpm: [50, 60],
  },
  meditation: {
    prompts: [
      "Calm meditation ambient with soft synth pads, gentle singing bowl tones and slow evolving textures. Peaceful, airy and grounding.",
      "Spacious ambient drone with warm pads, soft distant piano notes and subtle nature ambience. Very slow, serene and restful.",
      "Healing-ambient style soundscape with soft pads, light chimes and slow breathing dynamics, tranquil and spacious.",
    ],
    negative: "drums, percussion, vocals, beat, fast, loud, harsh, distorted",
    bpm: [50, 62],
  },
  deep_sleep: {
    prompts: [
      "Deep ambient drone, warm low and mid tones that slowly rise and fade over many seconds, two or three tones gently blending, soft misty texture, full but not boomy bass, very little brightness, no melody, no rhythm.",
      "Slow evolving dark ambient pad, long sustained warm tones crossfading into each other, hazy and calm, low-mid focused, no percussion, no melody, very steady volume.",
      "Minimal sleep drone: soft warm sine-like tones and a gentle low foundation, slowly breathing swells, foggy and peaceful, no high frequencies, no beat.",
    ],
    negative:
      "drums, percussion, beat, melody, vocals, noise, hiss, bright, shimmer, harsh, distorted, fast, loud",
    bpm: [40, 50],
  },
  cosmic: {
    prompts: [
      "Cosmic space ambient with slow evolving warm pads, shimmering high textures and soft deep tones, floating and serene, no drums.",
      "Spacey ambient soundscape, gentle synth swells like distant nebulae, soft bell-like tones, slow and dreamy, peaceful night sky.",
      "Calm interstellar ambient with warm analog pads, slow arpeggiated glimmers and soft reverb, weightless and relaxing.",
    ],
    negative: "drums, percussion, beat, vocals, noise, harsh, distorted, fast, loud",
    bpm: [46, 58],
  },
  lofi: {
    prompts: [
      "Drumless lo-fi with a warm Rhodes electric piano playing soft jazzy seventh chords, relaxed and loose timing, gentle bass, very faint tape hiss. Calm study and reading music, no drums.",
      "Chill lo-fi instrumental without drums: mellow electric piano chords, soft analog warmth, slow lazy groove from the chord rhythm, cozy late night mood.",
      "Soft lo-fi jazz ambience, warm electric piano and muted bass, simple soothing chord loop, subtle vinyl texture far in the background, no percussion.",
    ],
    negative:
      "drums, percussion, hi-hat, snare, kick, beat, vocals, vinyl crackle pops, harsh, distorted, fast, loud",
    bpm: [55, 65],
  },
  dark_blues: {
    prompts: [
      "Instrumental dark blues, slow and hypnotic. Heavy resonator slide guitar with a gritty tone, deep upright bass, brushed drums on a slow 12/8 shuffle, smoky late-night bar, southern gothic mood.",
      "Slow outlaw country blues instrumental: haunting slide guitar over a droning low E, steady kick and soft snare, warm organ pad far behind, dusty desert highway at midnight, stoic and cinematic.",
      "Moody dark blues jam: clean electric guitar with tremolo and slide, walking bass, sparse ride cymbal, long sustained notes and space, melancholic and reflective, whiskey and rain.",
    ],
    negative:
      "vocals, singing, lyrics, pop, edm, fast tempo, happy, bright, harsh distortion, shrill",
    bpm: [60, 72],
  },
};

export interface AiItem {
  prompt: string;
  negative: string;
  duration: number;
  seed: number;
}

/**
 * Toplam sureyi model sinirina gore bolumlere ayirir. Her bolum farkli istem/seed ile
 * uretilir ve sonra capraz gecisle birlestirilir.
 */
export function buildAiPlan(
  style: AiStyle,
  totalSec: number,
  seed: number,
  maxSegSec: number,
): AiItem[] {
  const r = rng(seed);
  const spec = PROMPTS[style];
  const n = Math.max(1, Math.ceil(totalSec / maxSegSec));
  const seg = Math.min(maxSegSec, Math.ceil(totalSec / n) + 8);
  const start = Math.floor(r() * spec.prompts.length);
  return Array.from({ length: n }, (_, i) => {
    const bpm = Math.round(spec.bpm[0] + r() * (spec.bpm[1] - spec.bpm[0]));
    return {
      prompt: `${BASE} ${spec.prompts[(start + i) % spec.prompts.length]} ${bpm} BPM`,
      negative: spec.negative,
      duration: seg,
      seed: Math.floor(r() * 2_000_000_000),
    };
  });
}

export function maxSegmentSec(model: string | undefined): number {
  return model === "medium" ? 360 : 120;
}

/** Kategori -> yapay zeka stili (muzik kategorileri). */
export function aiStyleForCategory(category: string): AiStyle | null {
  if (
    category === "nordic" ||
    category === "piano" ||
    category === "piano_violin" ||
    category === "strings" ||
    category === "lofi" ||
    category === "dark_blues"
  )
    return category;
  if (category === "meditation" || category === "deep_sleep" || category === "cosmic")
    return category;
  return null;
}
