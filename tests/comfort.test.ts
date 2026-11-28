import { describe, expect, it } from "vitest";
import {
  COMFORT_LIMITS,
  comfortClass,
  comfortFix,
  comfortGraph,
  evaluateComfort,
  parseComfort,
} from "../src/lib/comfort";
import { composeMusic } from "../src/lib/composer";

describe("ses rahatlik denetimi", () => {
  it("turleri siniflara ayirir", () => {
    expect(comfortClass("deep_sleep")).toBe("sleep");
    expect(comfortClass("rain")).toBe("nature");
    expect(comfortClass("dark_blues")).toBe("listen");
    expect(COMFORT_LIMITS.sleep.air).toBeLessThan(COMFORT_LIMITS.nature.air);
  });

  it("ffmpeg ciktisini filtre sirasina gore okur", () => {
    const err = [
      "[Parsed_volumedetect_6 @ 0x1] mean_volume: -52.1 dB",
      "[Parsed_volumedetect_4 @ 0x2] mean_volume: -41.5 dB",
      "[Parsed_volumedetect_1 @ 0x3] mean_volume: -19.9 dB",
    ].join("\n");
    expect(parseComfort(err)).toEqual({ full: -19.9, presence: -21.6, air: -32.2 });
    expect(parseComfort("bos")).toBeNull();
    expect(comfortGraph("highpass=f=30")).toContain("[0:a]highpass=f=30,asplit=3");
  });

  it("sinirdaysa dokunmaz, asarsa yumusatici EQ onerir", () => {
    const ok = { full: -20, presence: -22, air: -40 };
    expect(evaluateComfort(ok, "sleep").ok).toBe(true);
    expect(comfortFix(ok, "sleep")).toEqual([]);
    const harsh = { full: -21, presence: -8.5, air: -14.6 };
    expect(evaluateComfort(harsh, "nature").ok).toBe(false);
    const fix = comfortFix(harsh, "nature");
    expect(fix.some((f) => f.startsWith("equalizer=f=3200"))).toBe(true);
    expect(fix.some((f) => f.startsWith("highshelf=f=6000"))).toBe(true);
  });

  it("uyku stillerinde melodi tiz perdeye cikmaz; blues slide ve nordic vokal alcak", () => {
    const top = (style: Parameters<typeof composeMusic>[0], ch?: number) =>
      Math.max(
        ...composeMusic(style, 9, 300)
          .events.filter((e) => e.type === "on" && (ch === undefined || e.ch === ch))
          .map((e) => (e.type === "on" ? e.note : 0)),
      );
    // C5 = 72; ton kokune gore en cok bir oktav + kok kaymasi
    expect(top("piano_violin")).toBeLessThanOrEqual(80);
    expect(top("deep_sleep")).toBeLessThanOrEqual(80);
    expect(top("felt_piano")).toBeLessThanOrEqual(69);
    expect(top("dark_blues", 1)).toBeLessThanOrEqual(74);
    expect(top("nordic_ritual", 4)).toBeLessThanOrEqual(72);
  });
});
