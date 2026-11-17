import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getAsset, getLicense } from "../src/lib/assets";
import { claimNextJob, completeJob, enqueueJob, getJob } from "../src/lib/jobs";
import { createProject, createProjectSchema } from "../src/lib/projects";
import { handlers } from "../src/worker/handlers";
import { memoryDb } from "./helpers";

describe("yapay zeka 4K gorsel isi (sahte kopru ile)", () => {
  it("4K kare + 4K hareketli dongu; 4K render yeniden kodlamadan kullanir", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omy-aiv-"));
    const aiDir = path.join(dir, "ai");
    fs.mkdirSync(aiDir, { recursive: true });
    fs.writeFileSync(path.join(aiDir, "gorsel-durum.json"), JSON.stringify({ ready: true }));
    const db = memoryDb();
    const p = createProject(
      db,
      createProjectSchema.parse({
        title: "4K Göl",
        category: "meditation",
        durationHours: 1,
        resolution: "4k",
      }),
    );
    db.prepare("UPDATE projects SET duration_sec = 12 WHERE id = ?").run(p.id);
    const ctx = (job: NonNullable<ReturnType<typeof claimNextJob>>) => ({
      db,
      job,
      outputDir: path.join(dir, "out"),
      dataDir: dir,
      ffmpegPathSetting: process.env.FFMPEG_PATH || null,
      aiDir,
      imagePython: process.execPath,
      imageScript: path.resolve(__dirname, "fixtures/fake_image.mjs"),
    });
    enqueueJob(db, {
      type: "ai_visual",
      projectId: p.id,
      payload: { projectId: p.id, scene: "misty_lake", seed: 11, loopSec: 4 },
      maxAttempts: 1,
    });
    let job = claimNextJob(db)!;
    const r = (await handlers[job.type](ctx(job))) as { stillAssetId: string; loopAssetId: string };
    completeJob(db, job.id, r);
    const still = getAsset(db, r.stillAssetId)!;
    const loop = getAsset(db, r.loopAssetId)!;
    expect([still.width, still.height]).toEqual([3840, 2160]);
    expect([loop.width, loop.height]).toEqual([3840, 2160]);
    expect(loop.source).toBe("aivisual:misty_lake:11:loop");
    expect(loop.duration_sec!).toBeCloseTo(4, 0);
    expect(getLicense(db, loop.id)!.license_type).toMatch(/Apache-2.0/);

    // Ses: 12 sn ton
    const audioPath = path.join(dir, "a.flac");
    const { execFileSync } = await import("node:child_process");
    execFileSync(process.env.FFMPEG_PATH || "ffmpeg", [
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=220:duration=12",
      "-ac",
      "2",
      audioPath,
    ]);
    const { registerDerivedAsset } = await import("../src/lib/assets");
    const audio = await registerDerivedAsset(db, {
      projectId: p.id,
      filePath: audioPath,
      type: "audio",
      parentAssetId: null,
      source: "test:audio",
      originalName: "ton",
    });
    enqueueJob(db, {
      type: "render_video",
      projectId: p.id,
      payload: {
        projectId: p.id,
        audioAssetId: audio.id,
        visualAssetId: loop.id,
        mode: "preview",
        motion: "none",
        seamless: false,
      },
      maxAttempts: 1,
    });
    job = claimNextJob(db)!;
    const rr = await handlers[job.type](ctx(job));
    completeJob(db, job.id, rr);
    expect(getJob(db, job.id)!.status).toBe("succeeded");
    const render = db.prepare("SELECT * FROM renders WHERE id = ?").get(job.id) as {
      profile: string;
      status: string;
    };
    expect(render).toMatchObject({ profile: "preview_4k", status: "done" });
    fs.rmSync(dir, { recursive: true, force: true });
  }, 600_000);
});
