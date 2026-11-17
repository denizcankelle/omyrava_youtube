import { describe, expect, it } from "vitest";
import {
  CATEGORY_SCENES,
  SCENES,
  type SceneId,
  buildSceneLoopPlan,
  pickScene,
  scenePrompt,
} from "../src/lib/scene";
import { CATEGORIES } from "../src/lib/projects";
import { dims, evaluateFinal, x264For } from "../src/lib/render";

describe("yapay zeka sahneleri", () => {
  it("her kategori icin gecerli sahne ve istem", () => {
    for (const cat of Object.keys(CATEGORIES)) {
      const list = CATEGORY_SCENES[cat];
      expect(list?.length, cat).toBeGreaterThan(0);
      for (const seed of [1, 2, 3, 4, 5]) {
        const s = pickScene(cat, seed);
        expect(list).toContain(s);
        const p = scenePrompt(s, seed);
        expect(p).toMatch(/no people, no text/);
        expect(p.length).toBeLessThan(600);
      }
    }
  });
  it("dongu plani: 4K, nefes alan yakinlasma, katman dokulari once hazirlanir", () => {
    for (const id of Object.keys(SCENES) as SceneId[]) {
      const plan = buildSceneLoopPlan(id, 77, 3840, 2160);
      const loop = plan.steps.find((a) => a.at(-1) === "loop.mp4")!;
      const g = loop.join(" ");
      expect(g).toContain("perspective=");
      expect(g).toContain("scale=3840:2160");
      expect(g).toContain("-maxrate 14M");
      expect(loop[loop.indexOf("-t") + 1]).toBe("60");
      // Dongudeki tum girdi dokulari daha onceki adimlarda uretilir
      const made = plan.steps.slice(0, plan.steps.indexOf(loop)).map((a) => a.at(-1));
      for (let i = 0; i < loop.length; i++)
        if (loop[i] === "-i" && loop[i + 1].endsWith(".png") && loop[i + 1] !== "scene.png")
          expect(made).toContain(loop[i + 1]);
      expect(plan.steps.at(-1)!.at(-1)).toBe("still.png");
    }
  });
  it("hareketler donguyu tam boler (kusursuz tekrar)", () => {
    const g = buildSceneLoopPlan("rain_cabin", 5, 1920, 1080, 60).steps.flat().join(" ");
    for (const m of g.matchAll(/(vertical|horizontal)=-?([\d.]+)/g)) {
      const perLoop = Number(m[2]) * 60 * 30;
      expect(Math.abs(perLoop - Math.round(perLoop))).toBeLessThan(1e-3);
    }
  });
  it("cozunurluk: 4K boyutu ve son kontrol", () => {
    expect(dims("4k")).toEqual({ w: 3840, h: 2160 });
    expect(dims("1080p")).toEqual({ w: 1920, h: 1080 });
    expect(x264For(2160).join(" ")).toContain("-crf 23");
    const info = "Video: h264 (High), yuv420p, 3840x2160 Audio: aac";
    expect(evaluateFinal(info, 10, 10, 3840, 2160)).toEqual([]);
    expect(evaluateFinal(info, 10, 10)[0].message).toMatch(/1920×1080/);
  });
});
