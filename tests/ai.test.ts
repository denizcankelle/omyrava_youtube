import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AI_STYLES,
  type AiStyle,
  aiStyleForCategory,
  buildAiPlan,
  maxSegmentSec,
} from "../src/lib/ai";
import { getAsset, getLicense } from "../src/lib/assets";
import { claimNextJob, completeJob, enqueueJob } from "../src/lib/jobs";
import { createProject, createProjectSchema } from "../src/lib/projects";
import { getMetadata } from "../src/lib/publish";
import { handlers } from "../src/worker/handlers";
import { memoryDb } from "./helpers";

describe("yapay zeka plani", () => {
  it("sureyi model sinirina gore bolumlere ayirir; istemler cesitli", () => {
    for (const s of Object.keys(AI_STYLES) as AiStyle[]) {
      const plan = buildAiPlan(s, 1800, 5, maxSegmentSec("medium"));
      expect(plan.length).toBe(5);
      expect(plan.every((p) => p.duration <= 360)).toBe(true);
      expect(new Set(plan.map((p) => p.prompt)).size).toBeGreaterThan(1);
      expect(plan[0].prompt).toMatch(/Instrumental/);
      expect(plan[0].prompt).toMatch(/\d+ BPM$/);
      expect(buildAiPlan(s, 1800, 5, 360)).toEqual(plan);
    }
    expect(buildAiPlan("piano", 300, 1, maxSegmentSec("small-music")).length).toBe(3);
  });
  it("kategori eslemesi", () => {
    expect(aiStyleForCategory("nordic")).toBe("nordic");
    expect(aiStyleForCategory("meditation")).toBe("meditation");
    expect(aiStyleForCategory("rain")).toBeNull();
  });
});

function fakeAiEnv(dir: string) {
  const aiDir = path.join(dir, "ai");
  fs.mkdirSync(aiDir, { recursive: true });
  fs.writeFileSync(
    path.join(aiDir, "ai-durum.json"),
    JSON.stringify({ ready: true, model: "small-music" }),
  );
  return {
    aiDir,
    aiPython: process.execPath,
    aiScript: path.resolve(__dirname, "fixtures/fake_ai.mjs"),
  };
}

describe("yapay zeka muzik isi (sahte kopru ile)", () => {
  it("bolumleri uretir, birlestirir, -18 LUFS, lisans ve AI kaynagi", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omy-ai-"));
    const db = memoryDb();
    const p = createProject(
      db,
      createProjectSchema.parse({ title: "AI Test", category: "nordic", durationHours: 1 }),
    );
    enqueueJob(db, {
      type: "ai_music",
      payload: { projectId: p.id, style: "nordic", minutes: 3, seed: 9 },
    });
    const job = claimNextJob(db)!;
    const r = (await handlers[job.type]({
      db,
      job,
      outputDir: dir,
      dataDir: dir,
      ffmpegPathSetting: process.env.FFMPEG_PATH || null,
      ...fakeAiEnv(dir),
    })) as { assetId: string };
    completeJob(db, job.id, r);
    const a = getAsset(db, r.assetId)!;
    expect(a.source).toMatch(/^ai:nordic:9:small-music$/);
    // 2 bolum x 98 sn - 20 sn gecis
    expect(a.duration_sec!).toBeGreaterThan(174);
    expect(a.duration_sec!).toBeLessThan(178);
    expect(getLicense(db, a.id)!.provider).toMatch(/Stable Audio 3/);
    fs.rmSync(dir, { recursive: true, force: true });
  }, 120_000);

  it("otomatik akis yapay zekayi kullanir; hata olursa besteciye duser", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omy-ai-auto-"));
    const env = fakeAiEnv(dir);
    for (const fail of [false, true]) {
      const db = memoryDb();
      const p = createProject(
        db,
        createProjectSchema.parse({ title: "AI Oto", category: "piano", durationHours: 1 }),
      );
      db.prepare("UPDATE projects SET duration_sec = 60 WHERE id = ?").run(p.id);
      if (fail) process.env.FAKE_AI_FAIL = "1";
      enqueueJob(db, {
        type: "auto_produce",
        projectId: p.id,
        payload: { projectId: p.id, trackMinutes: 0.5, useAi: true, visual: "rain_window" },
        maxAttempts: 1,
      });
      const job = claimNextJob(db)!;
      const r = (await handlers[job.type]({
        db,
        job,
        outputDir: path.join(dir, "out"),
        dataDir: dir,
        ffmpegPathSetting: process.env.FFMPEG_PATH || null,
        soundfontPath: path.resolve(__dirname, "../soundfonts/FluidR3_GM.sf2"),
        ...env,
      })) as { audioAssetId: string; notes: string[] };
      delete process.env.FAKE_AI_FAIL;
      completeJob(db, job.id, r);
      const meta = getMetadata(db, p.id)!;
      if (!fail) {
        expect(meta.ai_generated).toBe(1);
        expect(meta.description).toMatch(/AI/);
        expect(r.notes.join(" ")).toMatch(/Stable Audio/);
      } else {
        expect(meta.ai_generated).toBe(0);
        expect(r.notes.join(" ")).toMatch(/besteci/);
      }
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }, 300_000);
});
