import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getAsset, importAssetFromPath, listAssets } from "../src/lib/assets";
import { claimNextJob, completeJob, enqueueJob } from "../src/lib/jobs";
import type { AudioAnalysis, VisualAnalysis } from "../src/lib/media";
import { createProject, createProjectSchema } from "../src/lib/projects";
import { handlers } from "../src/worker/handlers";
import { memoryDb } from "./helpers";

const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";

async function runNext(db: ReturnType<typeof memoryDb>, outputDir: string) {
  const job = claimNextJob(db)!;
  const result = await handlers[job.type]({
    db,
    job,
    outputDir,
    ffmpegPathSetting: process.env.FFMPEG_PATH || null,
  });
  completeJob(db, job.id, result);
  return result as Record<string, unknown>;
}

describe("medya analizi ve normalizasyon (FFmpeg ile)", () => {
  it("sessizligi ve seviyeyi bulur, normalize edip -18 LUFS'a getirir", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omy-media-"));
    const src = path.join(dir, "test.wav");
    // 15 sn ton + 12 sn sessizlik + 13 sn ton (sessiz seviye)
    execFileSync(ffmpeg, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=220:sample_rate=48000:duration=15",
      "-f",
      "lavfi",
      "-i",
      "anullsrc=r=48000:cl=mono:d=12",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=330:sample_rate=48000:duration=13",
      "-filter_complex",
      "[0:a][1:a][2:a]concat=n=3:v=0:a=1,volume=0.05[a]",
      "-map",
      "[a]",
      src,
    ]);
    const img = path.join(dir, "kare.png");
    execFileSync(ffmpeg, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=navy:s=800x800",
      "-frames:v",
      "1",
      img,
    ]);

    const db = memoryDb();
    const dataDir = path.join(dir, "data");
    const p = createProject(
      db,
      createProjectSchema.parse({ title: "Medya", category: "ocean", durationHours: 1 }),
    );
    const audio = await importAssetFromPath(db, dataDir, { projectId: p.id, sourcePath: src });
    const image = await importAssetFromPath(db, dataDir, { projectId: p.id, sourcePath: img });

    enqueueJob(db, { type: "asset_analyze", payload: { assetId: audio.id } });
    await runNext(db, dir);
    const a = JSON.parse(getAsset(db, audio.id)!.analysis!) as AudioAnalysis;
    expect(a.durationSec).toBeCloseTo(40, 0);
    expect(a.silences.some((s) => s.duration > 10 && s.start > 14 && s.start < 16)).toBe(true);
    expect(a.warnings.map((w) => w.message).join("|")).toMatch(/Uzun sessizlik/);
    expect(a.loudness!.input_i).toBeLessThan(-26);

    enqueueJob(db, { type: "asset_analyze", payload: { assetId: image.id } });
    await runNext(db, dir);
    const v = JSON.parse(getAsset(db, image.id)!.analysis!) as VisualAnalysis;
    expect(v.width).toBe(800);
    expect(v.warnings.length).toBe(2);

    enqueueJob(db, { type: "audio_normalize", payload: { assetId: audio.id } });
    const r = await runNext(db, dir);
    expect(fs.existsSync(r.outputPath as string)).toBe(true);
    expect(r.after as number).toBeGreaterThan(-19.5);
    expect(r.after as number).toBeLessThan(-16.5);
    const derived = listAssets(db, p.id).find((x) => x.parent_asset_id === audio.id)!;
    expect(derived.type).toBe("audio");
    expect(derived.checksum).toHaveLength(64);

    fs.rmSync(dir, { recursive: true, force: true });
  });
});
