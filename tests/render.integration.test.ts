import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { importAssetFromPath } from "../src/lib/assets";
import { claimNextJob, completeJob, enqueueJob, getJobLogs } from "../src/lib/jobs";
import { createProject, createProjectSchema, getProject } from "../src/lib/projects";
import { handlers } from "../src/worker/handlers";
import { memoryDb } from "./helpers";

const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
const gen = (args: string[]) =>
  execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", ...args]);

describe("uzun video render (FFmpeg ile)", () => {
  it("video donguden ve kisa sesten hedef sureli video uretir; proje 'ready' olur", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omy-render-"));
    const vid = path.join(dir, "dongu.mp4");
    const wav = path.join(dir, "ses.wav");
    gen(["-f", "lavfi", "-i", "testsrc2=s=1280x720:r=25:d=6", vid]);
    gen(["-f", "lavfi", "-i", "anoisesrc=color=pink:amplitude=0.2:d=20:r=44100", "-ac", "2", wav]);

    const db = memoryDb();
    const p = createProject(
      db,
      createProjectSchema.parse({ title: "Render Test", category: "cosmic", durationHours: 1 }),
    );
    // testi hizli tutmak icin hedef sureyi 90 sn yap
    db.prepare("UPDATE projects SET duration_sec = 90 WHERE id = ?").run(p.id);
    const dataDir = path.join(dir, "data");
    const outputDir = path.join(dir, "output");
    const a = await importAssetFromPath(db, dataDir, { projectId: p.id, sourcePath: wav });
    const v = await importAssetFromPath(db, dataDir, { projectId: p.id, sourcePath: vid });

    enqueueJob(db, {
      type: "render_video",
      projectId: p.id,
      payload: {
        projectId: p.id,
        audioAssetId: a.id,
        visualAssetId: v.id,
        mode: "full",
        seamless: true,
        motion: "none",
      },
    });
    const job = claimNextJob(db)!;
    const result = (await handlers.render_video({
      db,
      job,
      outputDir,
      dataDir,
      ffmpegPathSetting: process.env.FFMPEG_PATH || null,
    })) as { outputPath: string; durationSec: number };
    completeJob(db, job.id, result);

    expect(fs.existsSync(result.outputPath)).toBe(true);
    expect(result.durationSec).toBeGreaterThan(88.5);
    expect(result.durationSec).toBeLessThan(91.5);
    const info = execFileSync(
      ffmpeg,
      ["-hide_banner", "-i", result.outputPath, "-f", "null", "-t", "0.1", "-"],
      {
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    expect(info).toBeDefined();
    const r = db.prepare("SELECT * FROM renders WHERE id = ?").get(job.id) as {
      status: string;
      qa_status: string;
    };
    expect(r.status).toBe("done");
    expect(r.qa_status).toBe("passed");
    expect(getProject(db, p.id)!.status).toBe("ready");
    // ara dosyalar temizlendi
    expect(fs.existsSync(path.join(dataDir, "renders", p.id, job.id))).toBe(false);
    expect(getJobLogs(db, job.id).some((l) => /birleştirme tamam/.test(l.message))).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  }, 180_000);
});
