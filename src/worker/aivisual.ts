import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { IMAGE_LICENSE, readImageStatus } from "../lib/aiimage";
import {
  assetDir,
  licenseSchema,
  registerDerivedAsset,
  updateAssetMeta,
  upsertLicense,
} from "../lib/assets";
import { getConfig } from "../lib/config";
import { audit } from "../lib/db";
import { probeDurationSec, resolveFfmpegPath, runFfmpeg } from "../lib/ffmpeg";
import { JobError, isCancelled, logJob, updateProgress } from "../lib/jobs";
import { evaluateVisual } from "../lib/media";
import { getProject } from "../lib/projects";
import { dims } from "../lib/render";
import { SCENES, type SceneId, buildSceneLoopPlan, pickScene, scenePrompt } from "../lib/scene";
import type { JobHandler } from "./handlers";

interface BridgeEvent {
  event: string;
  index?: number;
  total?: number;
  seconds?: number;
  error?: string;
}

/**
 * Yapay zeka sahnesi: FLUX ile 4K kare, ardindan FFmpeg ile hafif hareketli kusursuz dongu.
 * Cikti: gorsel (4K kare) + video dongu (proje cozunurlugunde) varliklari, otomatik lisans.
 */
export const aiVisual: JobHandler = async (ctx) => {
  const { db, job, ffmpegPathSetting } = ctx;
  const p = JSON.parse(job.payload) as {
    projectId: string;
    scene?: SceneId;
    seed: number;
    /** Dongu suresi (sn); varsayilan 60. Testlerde kisaltilir. */
    loopSec?: number;
  };
  const project = getProject(db, p.projectId);
  if (!project) throw new JobError("PROJECT_NOT_FOUND", "Proje bulunamadı", false);
  const scene: SceneId =
    p.scene && p.scene in SCENES ? p.scene : pickScene(project.category, p.seed);
  const cfg = getConfig();
  const aiDir = ctx.aiDir ?? cfg.aiDir;
  const python = ctx.imagePython ?? cfg.imagePython;
  const script = ctx.imageScript ?? path.join(aiDir, "omyrava_image.py");
  const status = readImageStatus(aiDir);
  if (!status?.ready || !fs.existsSync(python))
    throw new JobError(
      "IMAGE_AI_NOT_READY",
      "Görsel yapay zekâsı kurulu değil. GORSEL-KUR.bat ile kur.",
      false,
    );
  const ffmpeg = resolveFfmpegPath(ffmpegPathSetting);
  const { w, h } = dims(project.resolution);
  const work = path.join(
    ctx.dataDir ?? ctx.outputDir,
    "work",
    `aiv-${job.id.slice(0, 8)}-${p.seed}`,
  );
  fs.mkdirSync(work, { recursive: true });
  const cancel = () => isCancelled(db, job.id);
  try {
    // 1) Yapay zeka karesi (4K)
    const prompt = scenePrompt(scene, p.seed);
    logJob(db, job.id, "info", `Sahne: ${SCENES[scene].label} — “${prompt.slice(0, 160)}…”`);
    const raw = path.join(work, "scene.png");
    const reqFile = path.join(work, "istek.json");
    fs.writeFileSync(reqFile, JSON.stringify({ items: [{ prompt, seed: p.seed, out: raw }] }));
    updateProgress(db, job.id, 0.02, "yapay zekâ modeli yükleniyor");
    await new Promise<void>((resolve, reject) => {
      const child = spawn(python, [script, "--batch", reqFile], {
        windowsHide: true,
        env: {
          ...process.env,
          HF_HOME: process.env.HF_HOME || path.join(aiDir, "hf-cache"),
          PYTHONIOENCODING: "utf-8",
          PYTHONUTF8: "1",
        },
      });
      let buf = "";
      let lastError = "";
      let stderr = "";
      const timer = setInterval(() => {
        if (cancel()) child.kill();
      }, 1000);
      child.stdout.on("data", (c: Buffer) => {
        buf += c.toString();
        const lines = buf.split(/\r?\n/);
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("{")) continue;
          let e: BridgeEvent;
          try {
            e = JSON.parse(line) as BridgeEvent;
          } catch {
            continue;
          }
          if (e.event === "encoded") updateProgress(db, job.id, 0.08, "model yükleniyor");
          if (e.event === "loaded") updateProgress(db, job.id, 0.15, "görsel üretiliyor");
          if (e.event === "generated") {
            updateProgress(db, job.id, 0.3, "4K'ya büyütülüyor");
            logJob(db, job.id, "info", `Kare üretildi (${e.seconds} sn)`);
          }
          if (e.event === "done") updateProgress(db, job.id, 0.4, "hareket katmanları");
          if (e.event === "error") lastError = e.error ?? "bilinmeyen hata";
        }
      });
      child.stderr.on("data", (c: Buffer) => (stderr = (stderr + c.toString()).slice(-4000)));
      child.on("error", (err) => {
        clearInterval(timer);
        reject(new JobError("IMAGE_AI_SPAWN", `Python başlatılamadı: ${err.message}`, false));
      });
      child.on("close", (code) => {
        clearInterval(timer);
        if (cancel()) return reject(new JobError("CANCELLED", "İş iptal edildi", false));
        if (code === 0 && fs.existsSync(raw)) return resolve();
        const msg = (lastError || stderr.split("\n").slice(-6).join(" | ")).slice(0, 1500);
        const oom = /out of memory|CUDA error/i.test(msg);
        reject(
          new JobError(oom ? "IMAGE_AI_OOM" : "IMAGE_AI_FAILED", `Görsel üretilemedi: ${msg}`, oom),
        );
      });
    });

    // 2) Hareketli kusursuz dongu
    const plan = buildSceneLoopPlan(
      scene,
      p.seed,
      w,
      h,
      Math.max(4, Math.min(120, p.loopSec ?? 60)),
    );
    logJob(db, job.id, "info", plan.description);
    for (let i = 0; i < plan.steps.length; i++) {
      const args = plan.steps[i];
      const isLoop = args.at(-1) === "loop.mp4";
      await runFfmpeg({
        ffmpegPath: ffmpeg,
        args,
        cwd: work,
        expectedDurationSec: isLoop ? plan.loopSec : undefined,
        shouldCancel: cancel,
        onProgress: (f) =>
          updateProgress(
            db,
            job.id,
            0.4 + ((i + f) / plan.steps.length) * 0.55,
            isLoop ? "video döngü" : "katmanlar",
          ),
      });
    }

    // 3) Varliklar
    const dir = assetDir(ctx.dataDir ?? ctx.outputDir, project.id);
    fs.mkdirSync(dir, { recursive: true });
    const base = `ai-${scene}-${p.seed}`;
    const stillDest = path.join(dir, `${base}.png`);
    const loopDest = path.join(dir, `${base}.mp4`);
    fs.copyFileSync(raw, stillDest);
    fs.copyFileSync(path.join(work, "loop.mp4"), loopDest);
    const license = licenseSchema.parse({
      ...IMAGE_LICENSE,
      notes: `Otomatik kayıt. Sahne: ${SCENES[scene].label}. Seed ${p.seed}. İstem: ${prompt}`,
      reviewed: true,
    });
    const label = SCENES[scene].label;
    const still = await registerDerivedAsset(db, {
      projectId: project.id,
      filePath: stillDest,
      type: "image",
      parentAssetId: null,
      source: `aivisual:${scene}:${p.seed}:still`,
      originalName: `${label} · yapay zekâ · #${p.seed} (4K kare)`,
    });
    upsertLicense(db, still.id, license);
    const stillMeta = { width: 3840, height: 2160, durationSec: null, sizeBytes: still.size_bytes };
    updateAssetMeta(db, still.id, {
      width: 3840,
      height: 2160,
      analysis: { kind: "visual", ...stillMeta, warnings: evaluateVisual("image", stillMeta) },
    });
    const loop = await registerDerivedAsset(db, {
      projectId: project.id,
      filePath: loopDest,
      type: "video_loop",
      parentAssetId: null,
      source: `aivisual:${scene}:${p.seed}:loop`,
      originalName: `${label} · yapay zekâ · #${p.seed} (döngü ${h === 2160 ? "4K" : h === 1440 ? "2K" : "1080p"})`,
    });
    upsertLicense(db, loop.id, license);
    const dur = await probeDurationSec(ffmpeg, loopDest);
    const loopMeta = { width: w, height: h, durationSec: dur, sizeBytes: loop.size_bytes };
    updateAssetMeta(db, loop.id, {
      durationSec: dur,
      width: w,
      height: h,
      analysis: { kind: "visual", ...loopMeta, warnings: evaluateVisual("video_loop", loopMeta) },
    });
    audit(db, "visual.ai", "project", project.id, { scene, seed: p.seed });
    logJob(db, job.id, "info", `Hazır: ${label} (${w}×${h}, ${dur?.toFixed(0)} sn döngü)`);
    return { stillAssetId: still.id, loopAssetId: loop.id, scene };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
};
