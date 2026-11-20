import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getAsset, getLicense } from "../src/lib/assets";
import { claimNextJob, completeJob, enqueueJob } from "../src/lib/jobs";
import type { AudioAnalysis } from "../src/lib/media";
import { createProject, createProjectSchema } from "../src/lib/projects";
import { handlers } from "../src/worker/handlers";
import { memoryDb } from "./helpers";

const sf = path.resolve(__dirname, "../soundfonts/FluidR3_GM.sf2");

describe.skipIf(!fs.existsSync(sf))("besteci ile muzik uretimi (SoundFont + FFmpeg)", () => {
  it("viking ve piyano+keman: 45 sn, -18 LUFS, lisans kaydi", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omy-music-"));
    const db = memoryDb();
    const p = createProject(
      db,
      createProjectSchema.parse({ title: "Müzik", category: "nordic", durationHours: 1 }),
    );
    for (const style of ["nordic", "piano_violin"]) {
      enqueueJob(db, {
        type: "music_compose",
        payload: { projectId: p.id, style, minutes: 0.75, seed: 31337 },
      });
      const job = claimNextJob(db)!;
      const r = (await handlers[job.type]({
        db,
        job,
        outputDir: dir,
        dataDir: dir,
        ffmpegPathSetting: process.env.FFMPEG_PATH || null,
        soundfontPath: sf,
      })) as { assetId: string };
      completeJob(db, job.id, r);
      const a = getAsset(db, r.assetId)!;
      const an = JSON.parse(a.analysis!) as AudioAnalysis;
      expect(a.duration_sec!).toBeCloseTo(45, 0);
      expect(an.loudness!.input_i).toBeGreaterThan(-20);
      expect(an.loudness!.input_tp).toBeLessThan(-1.5);
      expect(getLicense(db, a.id)!.license_type).toMatch(/MIT|GeneralUser GS/);
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }, 120_000);
});

describe.skipIf(!fs.existsSync(sf))("muzik uretimi iptal", () => {
  it("calarken iptal edilince temiz durur, worker'i cokerten hata birakmaz", async () => {
    const { cancelJob } = await import("../src/lib/jobs");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omy-cancel-"));
    const db = memoryDb();
    const p = createProject(
      db,
      createProjectSchema.parse({ title: "İptal", category: "piano", durationHours: 1 }),
    );
    enqueueJob(db, {
      type: "music_compose",
      payload: { projectId: p.id, style: "piano", minutes: 10, seed: 1 },
    });
    const job = claimNextJob(db)!;
    const run = handlers[job.type]({
      db,
      job,
      outputDir: dir,
      dataDir: dir,
      ffmpegPathSetting: process.env.FFMPEG_PATH || null,
      soundfontPath: sf,
    });
    setTimeout(() => cancelJob(db, job.id), 800);
    await expect(run).rejects.toMatchObject({ code: "CANCELLED" });
    await new Promise((r) => setTimeout(r, 500));
    fs.rmSync(dir, { recursive: true, force: true });
  }, 60_000);
});
