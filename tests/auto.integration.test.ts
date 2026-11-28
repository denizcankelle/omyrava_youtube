import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getAsset, listAssets } from "../src/lib/assets";
import { claimNextJob, completeJob, enqueueJob, getJob } from "../src/lib/jobs";
import {
  approvalBlockers,
  createProject,
  createProjectSchema,
  getProject,
} from "../src/lib/projects";
import { getMetadata, metadataIssues } from "../src/lib/publish";
import { handlers } from "../src/worker/handlers";
import { memoryDb } from "./helpers";

describe("tam otomatik akis (FFmpeg ile)", () => {
  it("hazirla -> onizleme -> tam render + paket; onay engeli kalmaz", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omy-auto-"));
    const db = memoryDb();
    const p = createProject(
      db,
      createProjectSchema.parse({ title: "Otomatik Yağmur", category: "ocean", durationHours: 1 }),
    );
    db.prepare("UPDATE projects SET duration_sec = 90 WHERE id = ?").run(p.id);
    const run = async () => {
      const job = claimNextJob(db)!;
      const r = await handlers[job.type]({
        db,
        job,
        outputDir: path.join(dir, "out"),
        dataDir: dir,
        ffmpegPathSetting: process.env.FFMPEG_PATH || null,
      });
      completeJob(db, job.id, r);
      return { job, r: r as Record<string, unknown> };
    };

    enqueueJob(db, {
      type: "auto_produce",
      projectId: p.id,
      payload: { projectId: p.id, trackMinutes: 0.5 },
      maxAttempts: 1,
    });
    const { job, r } = await run();
    expect(getJob(db, job.id)!.status).toBe("succeeded");
    const mix = getAsset(db, r.audioAssetId as string)!;
    expect(mix.source).toMatch(/^mix:/);
    expect(getAsset(db, r.visualAssetId as string)!.type).toBe("video_loop");
    expect(getAsset(db, r.thumbnailAssetId as string)!.type).toBe("thumbnail");
    const preview = db.prepare("SELECT * FROM renders WHERE id = ?").get(job.id) as {
      status: string;
      duration_sec: number;
    };
    expect(preview.status).toBe("done");
    expect(preview.duration_sec).toBeGreaterThan(88);
    const meta = getMetadata(db, p.id)!;
    expect(meta.yt_title).toContain("Ocean");
    expect(meta.ai_generated).toBe(0);
    expect(metadataIssues(db, p.id).filter((i) => i.level === "error")).toEqual([]);
    expect(listAssets(db, p.id).length).toBeGreaterThanOrEqual(7);

    enqueueJob(db, {
      type: "auto_finalize",
      projectId: p.id,
      payload: { projectId: p.id, autoJobId: job.id },
    });
    const fin = await run();
    expect(fs.existsSync(path.join(fin.r.packageDir as string, "baslik-aciklama.txt"))).toBe(true);
    expect(fs.existsSync(path.join(fin.r.packageDir as string, "kapak.jpg"))).toBe(true);
    expect(fs.existsSync(path.join(fin.r.packageDir as string, "kapak-2.jpg"))).toBe(true);
    const clean = path.join(fin.r.packageDir as string, "kapak-yazisiz-2k.jpg");
    expect(fs.existsSync(clean)).toBe(true);
    expect(fs.statSync(clean).size).toBeLessThanOrEqual(2 * 1024 * 1024);
    expect(fs.existsSync(path.join(fin.r.packageDir as string, "kapak-3.jpg"))).toBe(true);
    expect(fs.existsSync(path.join(fin.r.packageDir as string, "short.mp4"))).toBe(true);
    expect(fs.readFileSync(path.join(fin.r.packageDir as string, "ceviriler.txt"), "utf8")).toMatch(
      /Deutsch/,
    );
    expect(
      fs.readFileSync(path.join(fin.r.packageDir as string, "short-baslik.txt"), "utf8"),
    ).toMatch(/#shorts/);
    expect(getProject(db, p.id)!.status).toBe("ready");
    expect(approvalBlockers(db, p.id)).toEqual([]);
    fs.rmSync(dir, { recursive: true, force: true });
  }, 400_000);
});
