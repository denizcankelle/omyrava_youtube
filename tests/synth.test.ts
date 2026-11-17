import { describe, expect, it } from "vitest";
import { bedArgs, effectiveCrossfade, sequenceArgs, sequenceDuration } from "../src/lib/mix";
import {
  SYNTH_PRESETS,
  buildSynthPlan,
  gainToTarget,
  rng,
  type SynthPreset,
} from "../src/lib/synth";

describe("sentez plani", () => {
  it("rng deterministik", () => {
    const a = rng(42);
    const b = rng(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(rng(1)()).not.toBe(rng(2)());
  });
  it("her tur icin komut uretir; ayni seed ayni, farkli seed farkli", () => {
    for (const p of Object.keys(SYNTH_PRESETS) as SynthPreset[]) {
      const a = buildSynthPlan(p, 123456, 600, "o.flac");
      const b = buildSynthPlan(p, 123456, 600, "o.flac");
      const c = buildSynthPlan(p, 654321, 600, "o.flac");
      expect(a.args).toEqual(b.args);
      expect(a.args.join(" ")).not.toEqual(c.args.join(" "));
      expect(a.args.at(-1)).toBe("o.flac");
      expect(a.args.join(" ")).toContain("d=600");
      expect(a.description.length).toBeGreaterThan(5);
    }
  });
  it("hedef kazanc tepe sinirini asmaz", () => {
    expect(gainToTarget(-24, -10)).toBe(6);
    expect(gainToTarget(-24, -4)).toBe(2);
    expect(gainToTarget(-12, -1)).toBe(-6);
  });
});

describe("karisim plani", () => {
  it("capraz gecis en kisa parcaya gore sinirlanir", () => {
    expect(effectiveCrossfade([60], 8)).toBe(0);
    expect(effectiveCrossfade([60, 120], 8)).toBe(8);
    expect(effectiveCrossfade([10, 120], 8)).toBeCloseTo(4.9);
    expect(sequenceDuration([60, 120, 90], 8)).toBe(254);
  });
  it("acrossfade zinciri ve alt katman", () => {
    const s = sequenceArgs(["a", "b", "c"], 8, "o.flac").join(" ");
    expect(s).toContain("[s0][s1]acrossfade=d=8.000");
    expect(s).toContain("[x1][s2]acrossfade=d=8.000:c1=qsin:c2=qsin[o]");
    expect(sequenceArgs(["a"], 8, "o.flac").join(" ")).toContain("[s0]anull[o]");
    expect(sequenceArgs(["a", "b"], 0, "o.flac").join(" ")).toContain("concat=n=2");
    const b = bedArgs("m", "rain", -14, "o").join(" ");
    expect(b).toContain("-stream_loop -1 -i rain");
    expect(b).toContain("volume=-14dB");
    expect(b).toContain("duration=first");
  });
  it("dalgalar 8–15 sn araliginda gelip ceker (faz hizi siniri)", () => {
    for (const seed of [1, 2, 3, 99]) {
      const plan = buildSynthPlan("waves_soft", seed, 60, "o.flac");
      const g = plan.args.join(" ");
      const M = Number(/t\/([\d.]+)-/.exec(g)![1]);
      const hizMin = 1 / M - 0.018 - 0.008;
      const hizMax = 1 / M + 0.018 + 0.008;
      expect(1 / hizMax).toBeGreaterThanOrEqual(8);
      expect(1 / hizMin).toBeLessThanOrEqual(15);
    }
  });
  it("yeni sesler: yagmur esit (±%5), ambient 30–60 sn akor, derin ambient melodisiz", () => {
    expect(buildSynthPlan("rain_glass", 4, 60, "o.flac").args.join(" ")).toContain("0.95+0.05*sin");
    const amb = buildSynthPlan("ambient_warm", 4, 60, "o.flac").description;
    const c = Number(/akor başına (\d+) sn/.exec(amb)![1]);
    expect(c).toBeGreaterThanOrEqual(30);
    expect(c).toBeLessThanOrEqual(60);
    const deep = buildSynthPlan("deep_ambient", 4, 60, "o.flac").description;
    const s = Number(/3 ses (\d+) sn/.exec(deep)![1]);
    expect(s).toBeGreaterThanOrEqual(15);
    expect(s).toBeLessThanOrEqual(30);
    expect(buildSynthPlan("vinyl_hiss", 4, 60, "o.flac").args.join(" ")).not.toContain("crackle");
  });
});
