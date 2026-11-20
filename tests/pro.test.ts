import { describe, expect, it } from "vitest";
import { weeklyPlan } from "../src/lib/plan";
import { createProject, createProjectSchema } from "../src/lib/projects";
import { buildSceneLoopPlan } from "../src/lib/scene";
import { addStat, statSchema } from "../src/lib/stats";
import { clock, trackNames, trackStarts, tracklistText } from "../src/lib/tracklist";
import { translationsText } from "../src/lib/translations";
import { memoryDb } from "./helpers";

describe("playlist parca listesi", () => {
  it("benzersiz adlar, dogru zaman damgalari, YouTube bolum kosullari", () => {
    const names = trackNames("dark_blues", 7, 6);
    expect(new Set(names).size).toBe(6);
    expect(trackNames("dark_blues", 7, 6)).toEqual(names);
    expect(trackStarts([600, 600, 600], 4)).toEqual([0, 596, 1192]);
    const t = tracklistText({
      names,
      durations: Array(6).fill(600),
      crossfade: 4,
      videoSec: 3600,
      lang: "en",
    })!;
    const lines = t.split("\n");
    expect(lines[0]).toBe("Tracklist:");
    expect(lines[1]).toMatch(/^0:00:00 /);
    expect(lines[2]).toMatch(/^0:09:56 /);
    expect(
      tracklistText({
        names: names.slice(0, 2),
        durations: [600, 600],
        crossfade: 4,
        videoSec: 1200,
        lang: "tr",
      }),
    ).toBeNull();
    const rep = tracklistText({
      names: names.slice(0, 3),
      durations: [600, 600, 600],
      crossfade: 4,
      videoSec: 8 * 3600,
      lang: "tr",
    })!;
    expect(rep).toMatch(/tekrar eder/);
    expect(clock(3725, true)).toBe("1:02:05");
  });
});

describe("ceviriler", () => {
  it("kaynak dil disinda en/tr + de/es/pt, karanlik ekran ve yapay zeka beyani", () => {
    const t = translationsText({
      category: "rain",
      durationSec: 8 * 3600,
      sourceLang: "tr",
      aiGenerated: true,
      darkAfterMin: 20,
      tracklist: null,
    });
    for (const l of ["İngilizce", "Almanca", "İspanyolca", "Portekizce"]) expect(t).toContain(l);
    expect(t).not.toContain("=== Türkçe");
    expect(t).toContain("8 Stunden");
    expect(t).toContain("20 minutos");
    expect(t).toMatch(/KI-Werkzeugen/);
  });
});

describe("haftalik plan", () => {
  it("3 gun, ayni tur ust uste yok; veriyle en iyi tur once", () => {
    const db = memoryDb();
    const p0 = weeklyPlan(db, new Date("2026-11-20T10:00:00"));
    expect(p0.map((p) => new Date(`${p.date}T12:00:00`).getDay())).toEqual([6, 2, 4]);
    expect(new Set(p0.map((p) => p.category)).size).toBe(3);
    const mk = (category: "rain" | "nordic" | "lofi", views: string, hours: string) => {
      const p = createProject(
        db,
        createProjectSchema.parse({ title: `T ${category}`, category, durationHours: 1 }),
      );
      addStat(db, statSchema.parse({ projectId: p.id, views, watchHours: hours }));
    };
    mk("rain", "100", "10");
    mk("nordic", "900", "400");
    mk("lofi", "300", "60");
    const p1 = weeklyPlan(db, new Date("2026-11-20T10:00:00"));
    expect(p1[0].category).toBe("nordic");
    for (let i = 1; i < p1.length; i++) expect(p1[i].category).not.toBe(p1[i - 1].category);
    expect(p1.some((p) => p.reason.includes("yeni tür"))).toBe(true);
  });
});

describe("sahne canliligi", () => {
  it("ates titremesi ve duman katmani donguye tam sigar", () => {
    const g = buildSceneLoopPlan("blues_bar", 3, 1920, 1080, 60).steps.flat().join(" ");
    expect(g).toContain("geq=lum=");
    for (const m of g.matchAll(/sin\(2\*PI\*(\d+)\*N\/1800/g))
      expect(Number(m[1])).toBeGreaterThan(0);
    for (const m of g.matchAll(/(vertical|horizontal)=-?([\d.]+)/g)) {
      const perLoop = Number(m[2]) * 1800;
      expect(Math.abs(perLoop - Math.round(perLoop))).toBeLessThan(1e-3);
    }
  });
});
