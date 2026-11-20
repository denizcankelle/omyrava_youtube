/**
 * Konvolusyon reverb: gercek bir mekanin yankisini taklit eden, ureteci kendi olan (kayit/lisans
 * gerektirmeyen) darbe yaniti (IR). Iki bagimsiz pembe gurultu kanali, ustel sonum, mekan
 * buyuklugune gore on gecikme ve parlaklik. Kuru SoundFont seslerine "salon / tas mekan / kulup"
 * hissi verir.
 */
import type { MusicStyle } from "./composer";

export interface ReverbProfile {
  label: string;
  /** -60 dB'ye inis suresi (sn). */
  rt60: number;
  preDelayMs: number;
  /** Kuyruk parlakligi (alcak geciren, Hz). */
  lowpass: number;
  /** Islak sesin kuru sese orani (dogrusal). */
  wet: number;
}

export const REVERB_PROFILES = {
  hall: { label: "konser salonu", rt60: 3.0, preDelayMs: 24, lowpass: 6000, wet: 0.3 },
  stone: { label: "taş mekân / mağara", rt60: 4.4, preDelayMs: 32, lowpass: 4800, wet: 0.38 },
  club: { label: "küçük kulüp", rt60: 1.3, preDelayMs: 12, lowpass: 7000, wet: 0.2 },
} satisfies Record<string, ReverbProfile>;

export type ReverbId = keyof typeof REVERB_PROFILES;

export const STYLE_REVERB: Partial<Record<MusicStyle, ReverbId>> = {
  nordic: "hall",
  nordic_ritual: "stone",
  dark_blues: "club",
};

/** Stereo darbe yaniti (WAV) uretir. */
export function irArgs(id: ReverbId, output: string): string[] {
  const p: ReverbProfile = REVERB_PROFILES[id];
  const len = (p.rt60 * 1.15).toFixed(2);
  const env = `volume='exp(-6.9078*t/${p.rt60})':eval=frame`;
  return [
    "-y",
    "-f",
    "lavfi",
    "-i",
    `anoisesrc=d=${len}:c=pink:seed=11:a=0.5:r=48000`,
    "-f",
    "lavfi",
    "-i",
    `anoisesrc=d=${len}:c=pink:seed=23:a=0.5:r=48000`,
    "-filter_complex",
    `[0][1]join=inputs=2:channel_layout=stereo,asetnsamples=n=64,${env},` +
      `highpass=f=120,lowpass=f=${p.lowpass},` +
      `adelay=delays=${p.preDelayMs}|${p.preDelayMs + 3}:all=0`,
    "-c:a",
    "pcm_f32le",
    output,
  ];
}

/** Kuru sese IR ile yanki ekler (kuru + islak karisim, tepe sinirlayici). */
export function reverbArgs(input: string, ir: string, output: string, id: ReverbId): string[] {
  const p: ReverbProfile = REVERB_PROFILES[id];
  return [
    "-y",
    "-i",
    input,
    "-i",
    ir,
    "-filter_complex",
    `[0:a]aformat=sample_rates=48000:channel_layouts=stereo,asplit[d][w];` +
      `[w][1:a]afir=dry=1:wet=1[rv];` +
      `[d][rv]amix=inputs=2:weights='1 ${p.wet}':normalize=0:duration=first,` +
      `alimiter=limit=0.95:level=false[o]`,
    "-map",
    "[o]",
    "-c:a",
    "flac",
    output,
  ];
}
