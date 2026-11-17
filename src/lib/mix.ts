/** Cok parcali uzun ses karisimi: parcalar capraz gecisle art arda, istege bagli alt katman. */
import { z } from "zod";

export const mixSchema = z.object({
  projectId: z.string().min(1),
  trackIds: z.array(z.string().min(1)).min(1, "En az bir parça seç").max(100),
  crossfadeSec: z.coerce.number().min(0).max(30).default(20),
  bedId: z.string().optional().nullable(),
  bedDb: z.coerce.number().min(-40).max(0).default(-14),
  normalize: z.boolean().default(true),
});

export type MixOptions = z.infer<typeof mixSchema>;

const f3 = (x: number) => x.toFixed(3);

/** Capraz gecis suresi en kisa parcanin yarisini gecmesin. */
export function effectiveCrossfade(durations: number[], requested: number): number {
  if (durations.length < 2) return 0;
  const shortest = Math.min(...durations);
  return Math.max(0, Math.min(requested, shortest / 2 - 0.1));
}

export function sequenceDuration(durations: number[], crossfade: number): number {
  return durations.reduce((s, d) => s + d, 0) - crossfade * Math.max(0, durations.length - 1);
}

/** Parcalari sirayla birlestirir (acrossfade zinciri). */
export function sequenceArgs(inputs: string[], crossfade: number, output: string): string[] {
  const args = ["-y"];
  for (const i of inputs) args.push("-i", i);
  const prep = inputs
    .map((_, i) => `[${i}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[s${i}]`)
    .join(";");
  let graph = prep;
  let last = "s0";
  for (let i = 1; i < inputs.length; i++) {
    const out = i === inputs.length - 1 ? "o" : `x${i}`;
    graph +=
      crossfade > 0
        ? `;[${last}][s${i}]acrossfade=d=${f3(crossfade)}:c1=qsin:c2=qsin[${out}]`
        : `;[${last}][s${i}]concat=n=2:v=0:a=1[${out}]`;
    last = out;
  }
  if (inputs.length === 1) graph += ";[s0]anull[o]";
  return [...args, "-filter_complex", graph, "-map", "[o]", "-c:a", "flac", output];
}

/** Alt katmani (or. yagmur) dongu halinde ana sesin altina karistirir. */
export function bedArgs(main: string, bed: string, bedDb: number, output: string): string[] {
  return [
    "-y",
    "-i",
    main,
    "-stream_loop",
    "-1",
    "-i",
    bed,
    "-filter_complex",
    `[1:a]aresample=48000,aformat=channel_layouts=stereo,volume=${bedDb}dB[b];` +
      `[0:a]aresample=48000,aformat=channel_layouts=stereo[m];` +
      `[m][b]amix=inputs=2:duration=first:normalize=0[o]`,
    "-map",
    "[o]",
    "-c:a",
    "flac",
    output,
  ];
}
