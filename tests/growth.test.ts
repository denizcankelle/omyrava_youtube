import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { backupDb, cleanup, listBackups } from "../src/lib/maintenance";
import { suggestMetadata, withDarkScreen } from "../src/lib/metadata";
import { createProject, createProjectSchema } from "../src/lib/projects";
import { darkConcatList, darkPlan } from "../src/lib/render";
import { CATEGORY_SCENES, pickFreshScene } from "../src/lib/scene";
import { shortArgs, shortText } from "../src/lib/shorts";
import { addStat, statSchema, summarize } from "../src/lib/stats";
import { thumbnailArgs } from "../src/lib/thumbnail";
import { memoryDb } from "./helpers";

describe("karanlik ekran", () => {
  it("tam dongulerde kararir; kisa videoda devre disi", () => {
    expect(darkPlan(0, 60, 36000)).toBeNull();
    const p = darkPlan(20, 60, 8 * 3600)!;
    expect(p).toMatchObject({ loops: 20, darkAtSec: 1200 });
    expect(p.blacks * 60).toBeGreaterThanOrEqual(8 * 3600 - 1200 - 8);
    expect(darkPlan(20, 60, 1200)).toBeNull();
    const list = darkConcatList(
      { loops: 2, darkAtSec: 120, blacks: 1 },
      "loop.mp4",
      "fade.mp4",
      "black.mp4",
    );
    expect(list.split("\n")).toEqual([
      "file 'loop.mp4'",
      "file 'loop.mp4'",
      "file 'fade.mp4'",
      "file 'black.mp4'",
    ]);
  });
  it("baslik ve aciklamaya bir kez eklenir", () => {
    const m = { title: "Rain | 8 Hours", description: "x", lang: "en" as const };
    const a = withDarkScreen(m, 20);
    expect(a.title).toBe("Rain | 8 Hours | Dark Screen");
    expect(a.description).toMatch(/after 20 minutes/);
    expect(withDarkScreen({ ...a, lang: "en" }, 20)).toEqual(a);
    expect(withDarkScreen({ title: "x".repeat(95), description: "", lang: "tr" }, 10).title).toBe(
      "x".repeat(95),
    );
  });
});

describe("cesitlilik", () => {
  it("son kullanilan sahneleri tekrar etmez", () => {
    const list = CATEGORY_SCENES.rain;
    for (let seed = 1; seed < 20; seed++)
      expect(pickFreshScene("rain", seed, [list[0]])).not.toBe(list[0]);
    // hepsi kullanildiysa en eskisi
    expect(pickFreshScene("rain", 3, [list[1], list[0]])).toBe(list[0]);
  });
  it("baslik sablonu doner, sahne her zaman baslikta", () => {
    const titles = [0, 1, 2].map(
      (variant) =>
        suggestMetadata({
          category: "rain",
          durationSec: 8 * 3600,
          scene: "Rainy Window",
          lang: "en",
          aiGenerated: true,
          variant,
        }).title,
    );
    expect(new Set(titles).size).toBe(3);
    for (const t of titles) expect(t).toContain("Rainy Window");
  });
  it("kapak varyasyonlari farkli duzen", () => {
    const base = {
      source: "s.png",
      isVideo: false,
      output: "k.jpg",
      lineCount: 2,
      fontSize: 100,
      quality: 2,
    };
    const v = [0, 1, 2].map((variant) => thumbnailArgs({ ...base, variant }).join(" "));
    expect(new Set(v).size).toBe(3);
    expect(v[1]).toContain("vignette");
    expect(v[0]).toContain("drawbox=x=0:y=");
  });
});

describe("shorts", () => {
  it("dikey 1080x1920, 30 sn, ses yumusak giris/cikis", () => {
    const a = shortArgs({
      loop: "l.mp4",
      audio: "a.flac",
      audioStartSec: 90,
      output: "s.mp4",
      titleLines: 2,
      withNote: true,
    }).join(" ");
    expect(a).toContain("scale=1080:1920");
    expect(a).toContain("-t 30");
    expect(a).toContain("line3.txt");
    expect(a).toContain("-ss 90.00");
    const t = shortText({
      title: "Rain – Rainy Window | 8 Hours",
      lang: "tr",
      hashtags: ["#yağmur"],
    });
    expect(t.title).toBe("Rain – Rainy Window #shorts");
    expect(t.description).toMatch(/#shorts/);
  });
});

describe("kanal panosu", () => {
  it("istatistik kaydi ve ozet/oneri", () => {
    const db = memoryDb();
    const mk = (category: "ocean" | "piano" | "ocean", title: string) =>
      createProject(db, createProjectSchema.parse({ title, category, durationHours: 1 }));
    const a = mk("ocean", "Yağmur 1");
    const b = mk("ocean", "Yağmur 2");
    const c = mk("piano", "Piyano 1");
    addStat(
      db,
      statSchema.parse({
        projectId: a.id,
        views: "1.200",
        watchHours: "300",
        avgViewMin: "14,5",
        ctr: "4.1",
      }),
    );
    addStat(
      db,
      statSchema.parse({
        projectId: a.id,
        views: "2000",
        watchHours: "500",
        recordedAt: "2099-01-01",
      }),
    );
    addStat(db, statSchema.parse({ projectId: b.id, views: "800", watchHours: "200", ctr: "2.1" }));
    addStat(db, statSchema.parse({ projectId: c.id, views: "300", watchHours: "40", ctr: "5" }));
    const s = summarize(db);
    expect(s.totals).toEqual({ videos: 3, views: 3100, watchHours: 740 });
    expect(s.byCategory[0]).toMatchObject({ key: "ocean", videos: 2 });
    expect(s.advice[0]).toMatch(/Ocean/);
    expect(s.advice.join(" ")).toMatch(/denenmemiş/);
  });
});

describe("bakim", () => {
  it("yedek alir, en fazla 14 tutar; eski ara dosyalari siler, calisan ise dokunmaz", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omy-bak-"));
    const db = memoryDb();
    for (let i = 0; i < 16; i++) backupDb(db, dir, new Date(2026, 0, 1, 0, 0, i));
    // mtime'lari sirala (ayni saniyede yazildi)
    listBackups(dir).forEach((b, i) =>
      fs.utimesSync(b.file, new Date(), new Date(Date.now() - i * 1000)),
    );
    expect(listBackups(dir).length).toBe(14);

    const work = path.join(dir, "work");
    fs.mkdirSync(path.join(work, "mix-aaaaaaaa"), { recursive: true });
    fs.writeFileSync(path.join(work, "mix-aaaaaaaa", "x.bin"), Buffer.alloc(1000));
    fs.mkdirSync(path.join(work, "mus-bbbbbbbb"), { recursive: true });
    db.prepare(
      "INSERT INTO jobs (id, type, status, payload) VALUES ('bbbbbbbb-0000-0000-0000-000000000000', 'x', 'running', '{}')",
    ).run();
    const later = Date.now() + 7 * 3600 * 1000;
    const r = cleanup(db, dir, { now: later });
    expect(r.removed).toBe(1);
    expect(r.bytes).toBe(1000);
    expect(fs.existsSync(path.join(work, "mus-bbbbbbbb"))).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
