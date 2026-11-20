import { describe, expect, it } from "vitest";
import { parseDuration } from "../src/lib/ffmpeg";
import { runMigrations } from "../src/lib/migrate";
import {
  createProject,
  createProjectSchema,
  formatDuration,
  getProject,
  safeFileName,
  setProjectStatus,
} from "../src/lib/projects";
import { InvalidTransitionError } from "../src/lib/status";
import path from "node:path";
import { memoryDb } from "./helpers";

describe("projeler", () => {
  it("yeni kategoriler (ocean, lofi) veritabanina kaydedilir", () => {
    const db = memoryDb();
    for (const category of ["ocean", "lofi", "dark_blues"] as const) {
      const p = createProject(
        db,
        createProjectSchema.parse({ title: `Yeni ${category}`, category, durationHours: 1 }),
      );
      expect(getProject(db, p.id)!.category).toBe(category);
    }
  });

  it("proje olusturur, sureyi saniyeye cevirir ve audit kaydi yazar", () => {
    const db = memoryDb();
    const input = createProjectSchema.parse({
      title: "Gece Yagmuru",
      category: "rain",
      durationHours: "8",
    });
    const p = createProject(db, input);
    expect(p.duration_sec).toBe(8 * 3600);
    expect(p.status).toBe("draft");
    const audits = db.prepare("SELECT * FROM audit_events").all();
    expect(audits).toHaveLength(1);
  });

  it("gecersiz girdiyi reddeder", () => {
    expect(
      createProjectSchema.safeParse({ title: "a", category: "rain", durationHours: 8 }).success,
    ).toBe(false);
    expect(
      createProjectSchema.safeParse({ title: "abc", category: "rock", durationHours: 8 }).success,
    ).toBe(false);
    expect(
      createProjectSchema.safeParse({ title: "abc", category: "rain", durationHours: 5 }).success,
    ).toBe(false);
  });

  it("durum gecisi kurallara uyar", () => {
    const db = memoryDb();
    const p = createProject(
      db,
      createProjectSchema.parse({ title: "Test", category: "piano", durationHours: 1 }),
    );
    expect(setProjectStatus(db, p.id, "queued").status).toBe("queued");
    expect(() => setProjectStatus(db, p.id, "published")).toThrow(InvalidTransitionError);
  });

  it("migration'lar iki kez calistirilinca tekrar uygulanmaz", () => {
    const db = memoryDb();
    expect(runMigrations(db, path.resolve(__dirname, "../migrations"))).toEqual([]);
  });
});

describe("yardimcilar", () => {
  it("guvenli dosya adi", () => {
    expect(safeFileName("Derin Uyku: Şırıl Şırıl Yağmur / 8 Saat")).toBe(
      "derin-uyku-siril-siril-yagmur-8-saat",
    );
    expect(safeFileName("???")).toBe("proje");
    expect(safeFileName("a".repeat(100))).toHaveLength(60);
  });
  it("sure formati", () => {
    expect(formatDuration(36000)).toBe("10 saat");
    expect(formatDuration(5400)).toBe("1 sa 30 dk");
  });
  it("FFmpeg ciktisindan sure okur", () => {
    expect(parseDuration("  Duration: 10:00:00.04, start: 0")).toBeCloseTo(36000.04);
    expect(parseDuration("Duration: N/A")).toBeNull();
  });
});

describe("FFmpeg bulma", () => {
  it("Windows'ta PATH yoksa winget, Program Files ve C:\\ffmpeg konumlarina bakar", async () => {
    const { ffmpegCandidates } = await import("../src/lib/ffmpeg");
    const c = ffmpegCandidates("win32", {
      PATH: 'C:\\Windows;"C:\\Tools\\bin"',
      LOCALAPPDATA: "C:\\Users\\deniz\\AppData\\Local",
      ProgramFiles: "C:\\Program Files",
    });
    expect(c[0]).toBe("C:\\Windows\\ffmpeg.exe");
    expect(c).toContain("C:\\Tools\\bin\\ffmpeg.exe");
    expect(c).toContain("C:\\Users\\deniz\\AppData\\Local\\Microsoft\\WinGet\\Links\\ffmpeg.exe");
    expect(c).toContain("C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe");
    expect(c).toContain("C:\\ffmpeg\\bin\\ffmpeg.exe");
  });
  it("ayarlanan yol yoksa null, varsa onu dondurur", async () => {
    const { findFfmpeg } = await import("../src/lib/ffmpeg");
    expect(findFfmpeg("/yok/ffmpeg")).toBeNull();
    expect(findFfmpeg(null, { PATH: "" })).not.toBe(undefined);
  });
});

describe("veritabani satirlari", () => {
  it("duz nesne doner (Next.js istemci bilesenlerine aktarilabilir)", () => {
    const db = memoryDb();
    const p = createProject(
      db,
      createProjectSchema.parse({ title: "Duz", category: "rain", durationHours: 1 }),
    );
    const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(p.id) as object;
    expect(Object.getPrototypeOf(row)).toBe(Object.prototype);
    const rows = db.prepare("SELECT * FROM projects").all() as object[];
    expect(Object.getPrototypeOf(rows[0])).toBe(Object.prototype);
  });
});

describe("proje iptali", () => {
  it("bekleyen isleri de iptal eder", async () => {
    const { enqueueJob, getJob } = await import("../src/lib/jobs");
    const db = memoryDb();
    const p = createProject(
      db,
      createProjectSchema.parse({ title: "İptal", category: "rain", durationHours: 1 }),
    );
    const j = enqueueJob(db, {
      type: "auto_produce",
      projectId: p.id,
      payload: { projectId: p.id },
    });
    setProjectStatus(db, p.id, "cancelled");
    expect(getJob(db, j.id)!.status).toBe("cancelled");
  });
});
