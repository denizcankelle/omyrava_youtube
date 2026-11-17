import { describe, expect, it } from "vitest";
import { RECIPES, thumbText } from "../src/lib/auto";
import { MUSIC_STYLES } from "../src/lib/composer";
import { SYNTH_PRESETS } from "../src/lib/synth";
import { VISUAL_PRESETS, type VisualPreset, buildVisualPlan } from "../src/lib/visual";

describe("gorsel plani", () => {
  it("her tur still.png ve loop.mp4 uretir; seed belirleyicidir", () => {
    for (const p of Object.keys(VISUAL_PRESETS) as VisualPreset[]) {
      const a = buildVisualPlan(p, 1234);
      const b = buildVisualPlan(p, 1234);
      const c = buildVisualPlan(p, 98765);
      expect(a.steps).toEqual(b.steps);
      expect(JSON.stringify(a.steps)).not.toEqual(JSON.stringify(c.steps));
      const outs = a.steps.map((s) => s.at(-1));
      expect(outs).toContain("loop.mp4");
      expect(outs).toContain("still.png");
      // Windows yol kacisi sorunu olmasin: komutlarda mutlak yol yok
      expect(JSON.stringify(a.steps)).not.toMatch(/[A-Z]:\\\\|\/tmp\//);
      expect([12, 30, 60]).toContain(a.loopSec);
    }
  });
  it("kayan katman hizlari donguyu tam boler", () => {
    for (const p of ["rain_window", "snow"] as const) {
      const plan = buildVisualPlan(p, 7);
      const g = plan.steps.find((s) => s.at(-1) === "loop.mp4")!.join(" ");
      const frames = 30 * plan.loopSec;
      for (const m of g.matchAll(/(vertical|horizontal)=-?([\d.]+)/g)) {
        const k = Number(m[2]) * frames;
        expect(Math.abs(k - Math.round(k))).toBeLessThan(1e-4);
      }
    }
  });
});

describe("otomatik tarifler", () => {
  it("her kategori gecerli ses ve gorsel turleri kullanir", () => {
    for (const r of Object.values(RECIPES)) {
      for (const t of r.tracks)
        expect("music" in t ? t.music in MUSIC_STYLES : t.preset in SYNTH_PRESETS).toBe(true);
      if (r.bed) expect(r.bed.preset in SYNTH_PRESETS).toBe(true);
      expect(r.visual in VISUAL_PRESETS).toBe(true);
      // En az ~45 dk ham ses
      expect(r.tracks.reduce((s, t) => s + t.minutes, 0)).toBeGreaterThanOrEqual(45);
    }
    expect(RECIPES.piano.tracks.every((t) => "music" in t && t.music === "felt_piano")).toBe(true);
    expect(RECIPES.piano.bed?.preset).toBe("rain_glass");
    expect(RECIPES.rain.bed?.preset).toBe("ambient_warm");
    expect(RECIPES.ocean.tracks.every((t) => "preset" in t && t.preset === "waves_soft")).toBe(
      true,
    );
    expect(RECIPES.lofi.bed).toMatchObject({ preset: "vinyl_hiss" });
    expect(RECIPES.lofi.bed!.db).toBeLessThanOrEqual(-25);
    expect(RECIPES.nordic.visual).toBe("aurora");
    expect(RECIPES.nordic.bed?.preset).toBe("wind");
  });
  it("kapak yazisi", () => {
    expect(thumbText(RECIPES.rain, 8 * 3600, "en")).toBe("8 HOURS\nRAIN & AMBIENT");
    expect(thumbText(RECIPES.cosmic, 3600, "tr")).toBe("1 SAAT\nKOZMİK UYKU");
  });
});
