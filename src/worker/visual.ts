import fs from "node:fs";
import path from "node:path";
import {
  assetDir,
  licenseSchema,
  registerDerivedAsset,
  updateAssetMeta,
  upsertLicense,
} from "../lib/assets";
import { audit } from "../lib/db";
import { probeDurationSec, resolveFfmpegPath, runFfmpeg } from "../lib/ffmpeg";
import { JobError, isCancelled, logJob, updateProgress } from "../lib/jobs";
import { evaluateVisual } from "../lib/media";
import { getProject } from "../lib/projects";
import { VISUAL_PRESETS, type VisualPreset, buildVisualPlan } from "../lib/visual";
import type { JobHandler } from "./handlers";

/** Yerlesik gorsel uretimi: temsil karesi (gorsel) + kusursuz video dongu, otomatik lisans. */
export const visualGenerate: JobHandler = async (ctx) => {
  const { db, job, ffmpegPathSetting } = ctx;
  const p = JSON.parse(job.payload) as { projectId: string; preset: VisualPreset; seed: number };
  if (!(p.preset in VISUAL_PRESETS))
    throw new JobError("BAD_PRESET", "Geçersiz görsel türü", false);
  const project = getProject(db, p.projectId);
  if (!project) throw new JobError("PROJECT_NOT_FOUND", "Proje bulunamadı", false);
  const ffmpeg = resolveFfmpegPath(ffmpegPathSetting);
  const work = path.join(
    ctx.dataDir ?? ctx.outputDir,
    "work",
    `vis-${job.id.slice(0, 8)}-${p.seed}`,
  );
  fs.mkdirSync(work, { recursive: true });
  try {
    const plan = buildVisualPlan(p.preset, p.seed);
    logJob(db, job.id, "info", plan.description);
    for (let i = 0; i < plan.steps.length; i++) {
      const args = plan.steps[i];
      const isLoop = args.at(-1) === "loop.mp4";
      updateProgress(
        db,
        job.id,
        0.02 + (i / plan.steps.length) * 0.9,
        isLoop ? "video döngü" : "görsel",
      );
      await runFfmpeg({
        ffmpegPath: ffmpeg,
        args,
        cwd: work,
        expectedDurationSec: isLoop ? plan.loopSec : undefined,
        shouldCancel: () => isCancelled(db, job.id),
        onProgress: (f) =>
          updateProgress(db, job.id, 0.02 + ((i + f) / plan.steps.length) * 0.9, "video döngü"),
      });
    }
    const dir = assetDir(ctx.dataDir ?? ctx.outputDir, project.id);
    fs.mkdirSync(dir, { recursive: true });
    const base = `${p.preset}-${p.seed}`;
    const stillDest = path.join(dir, `${base}.png`);
    const loopDest = path.join(dir, `${base}.mp4`);
    fs.copyFileSync(path.join(work, "still.png"), stillDest);
    fs.copyFileSync(path.join(work, "loop.mp4"), loopDest);

    const label = VISUAL_PRESETS[p.preset].label;
    const license = licenseSchema.parse({
      provider: "Omyrava Studio — yerleşik görsel üretim (FFmpeg)",
      licenseType: "Kendi üretimim; yapay zekâ kullanılmadı",
      notes: `Otomatik kayıt. ${plan.description}. Seed ${p.seed}.`,
      reviewed: true,
    });
    const still = await registerDerivedAsset(db, {
      projectId: project.id,
      filePath: stillDest,
      type: "image",
      parentAssetId: null,
      source: `visual:${p.preset}:${p.seed}:still`,
      originalName: `${label} · #${p.seed} (kare)`,
    });
    upsertLicense(db, still.id, license);
    const stillMeta = { width: 1920, height: 1080, durationSec: null, sizeBytes: still.size_bytes };
    updateAssetMeta(db, still.id, {
      width: 1920,
      height: 1080,
      analysis: { kind: "visual", ...stillMeta, warnings: evaluateVisual("image", stillMeta) },
    });

    const loop = await registerDerivedAsset(db, {
      projectId: project.id,
      filePath: loopDest,
      type: "video_loop",
      parentAssetId: null,
      source: `visual:${p.preset}:${p.seed}:loop`,
      originalName: `${label} · #${p.seed} (döngü)`,
    });
    upsertLicense(db, loop.id, license);
    const dur = await probeDurationSec(ffmpeg, loopDest);
    const loopMeta = { width: 1920, height: 1080, durationSec: dur, sizeBytes: loop.size_bytes };
    updateAssetMeta(db, loop.id, {
      durationSec: dur,
      width: 1920,
      height: 1080,
      analysis: { kind: "visual", ...loopMeta, warnings: evaluateVisual("video_loop", loopMeta) },
    });
    audit(db, "visual.generate", "project", project.id, { preset: p.preset, seed: p.seed });
    logJob(db, job.id, "info", `Hazır: ${label} (${dur?.toFixed(0)} sn döngü)`);
    return { stillAssetId: still.id, loopAssetId: loop.id };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
};
