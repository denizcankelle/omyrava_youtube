import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { claimNextJob, completeJob, enqueueJob, getJob } from "../src/lib/jobs";
import { createProject, createProjectSchema } from "../src/lib/projects";
import { handlers } from "../src/worker/handlers";
import { memoryDb } from "./helpers";

describe("ornek render (FFmpeg ile uctan uca)", () => {
  it("10 sn'lik 1080p video uretir ve QA'dan gecer", async () => {
    const db = memoryDb();
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "omyrava-"));
    const p = createProject(
      db,
      createProjectSchema.parse({ title: "Entegrasyon", category: "cosmic", durationHours: 1 }),
    );
    enqueueJob(db, { type: "sample_render", projectId: p.id, payload: { seconds: 3 } });
    const job = claimNextJob(db)!;
    const result = (await handlers.sample_render({
      db,
      job,
      outputDir,
      ffmpegPathSetting: process.env.FFMPEG_PATH || null,
    })) as { outputPath: string; durationSec: number };
    completeJob(db, job.id, result);
    expect(fs.existsSync(result.outputPath)).toBe(true);
    expect(result.durationSec).toBeGreaterThan(2.5);
    expect(getJob(db, job.id)!.status).toBe("succeeded");
    const renders = db.prepare("SELECT * FROM renders WHERE project_id = ?").all(p.id) as {
      qa_status: string;
    }[];
    expect(renders[0].qa_status).toBe("passed");
    fs.rmSync(outputDir, { recursive: true, force: true });
  });
});
