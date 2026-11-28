import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { AI_STYLES, type AiStyle, buildAiPlan, maxSegmentSec, readAiStatus } from "../lib/ai";
import {
  assetDir,
  licenseSchema,
  registerDerivedAsset,
  updateAssetMeta,
  upsertLicense,
} from "../lib/assets";
import { getConfig } from "../lib/config";
import { resolveFfmpegPath, runFfmpeg } from "../lib/ffmpeg";
import { JobError, isCancelled, logJob, updateProgress } from "../lib/jobs";
import { sequenceArgs, sequenceDuration } from "../lib/mix";
import { getProject } from "../lib/projects";
import { gainToTarget } from "../lib/synth";
import { comfortClass, comfortSummary } from "../lib/comfort";
import { type JobHandler, analyzeAudioFile, measureComfort, solveComfort } from "./handlers";

interface BridgeEvent {
  event: string;
  index?: number;
  total?: number;
  seconds?: number;
  error?: string;
  trace?: string;
}

/** Stable Audio 3 ile bolum bolum uretim, capraz gecisle birlestirme, -18 LUFS FLAC varlik. */
export const aiMusic: JobHandler = async (ctx) => {
  const { db, job, ffmpegPathSetting } = ctx;
  const p = JSON.parse(job.payload) as {
    projectId: string;
    style: AiStyle;
    minutes: number;
    seed: number;
  };
  if (!(p.style in AI_STYLES)) throw new JobError("BAD_STYLE", "Geçersiz yapay zekâ stili", false);
  const project = getProject(db, p.projectId);
  if (!project) throw new JobError("PROJECT_NOT_FOUND", "Proje bulunamadı", false);
  const cfg = getConfig();
  const aiDir = ctx.aiDir ?? cfg.aiDir;
  const python = ctx.aiPython ?? cfg.aiPython;
  const script = ctx.aiScript ?? path.join(aiDir, "omyrava_ai.py");
  const status = readAiStatus(aiDir);
  if (!status?.ready || !fs.existsSync(python))
    throw new JobError("AI_NOT_READY", "Yapay zekâ kurulu değil. AI-KUR.bat ile kur.", false);
  const ffmpeg = resolveFfmpegPath(ffmpegPathSetting);

  const totalSec = Math.round(p.minutes * 60);
  const items = buildAiPlan(p.style, totalSec, p.seed, maxSegmentSec(status.model));
  const work = path.join(
    ctx.dataDir ?? ctx.outputDir,
    "work",
    `ai-${job.id.slice(0, 8)}-${p.seed}`,
  );
  fs.mkdirSync(work, { recursive: true });
  try {
    const outs = items.map((_, i) => path.join(work, `seg${i}.wav`));
    const reqFile = path.join(work, "istek.json");
    fs.writeFileSync(
      reqFile,
      JSON.stringify({
        model: status.model ?? "medium",
        items: items.map((it, i) => ({ ...it, out: outs[i] })),
      }),
    );
    logJob(
      db,
      job.id,
      "info",
      `Yapay zekâ (${status.model}): ${items.length} bölüm × ${items[0].duration} sn`,
    );
    updateProgress(db, job.id, 0.02, "model yükleniyor");

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
      const cancelTimer = setInterval(() => {
        if (isCancelled(db, job.id)) child.kill();
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
          if (e.event === "loaded") updateProgress(db, job.id, 0.12, "üretiliyor");
          if (e.event === "start" && e.total)
            updateProgress(
              db,
              job.id,
              0.12 + (e.index! / e.total) * 0.58,
              `bölüm ${e.index! + 1}/${e.total}`,
            );
          if (e.event === "done" && e.total) {
            updateProgress(
              db,
              job.id,
              0.12 + ((e.index! + 1) / e.total) * 0.58,
              `bölüm ${e.index! + 1}/${e.total}`,
            );
            logJob(db, job.id, "info", `Bölüm ${e.index! + 1}/${e.total} hazır (${e.seconds} sn)`);
          }
          if (e.event === "error") lastError = e.error ?? "bilinmeyen hata";
        }
      });
      child.stderr.on("data", (c: Buffer) => (stderr = (stderr + c.toString()).slice(-4000)));
      child.on("error", (err) => {
        clearInterval(cancelTimer);
        reject(new JobError("AI_SPAWN", `Python başlatılamadı: ${err.message}`, false));
      });
      child.on("close", (code) => {
        clearInterval(cancelTimer);
        if (isCancelled(db, job.id))
          return reject(new JobError("CANCELLED", "İş iptal edildi", false));
        if (code === 0) return resolve();
        const msg = (lastError || stderr.split("\n").slice(-6).join(" | ")).slice(0, 1500);
        const oom = /out of memory|CUDA error/i.test(msg);
        reject(
          new JobError(oom ? "AI_OOM" : "AI_FAILED", `Yapay zekâ üretimi başarısız: ${msg}`, oom),
        );
      });
    });

    for (const o of outs)
      if (!fs.existsSync(o))
        throw new JobError("AI_OUTPUT_MISSING", `Çıktı yok: ${path.basename(o)}`);
    const xf = outs.length > 1 ? 20 : 0;
    const seq = path.join(work, "seq.flac");
    updateProgress(db, job.id, 0.72, "birleştirme");
    await runFfmpeg({
      ffmpegPath: ffmpeg,
      args: sequenceArgs(outs, xf, seq),
      expectedDurationSec: sequenceDuration(
        items.map((i) => i.duration),
        xf,
      ),
      shouldCancel: () => isCancelled(db, job.id),
    });
    const cls = comfortClass(p.style);
    const { first: cm, fix } = await solveComfort(ffmpeg, seq, cls);
    let src = seq;
    if (cm && fix.length) {
      logJob(db, job.id, "info", `Yumuşatılıyor: ${comfortSummary(cm)}`);
      src = path.join(work, "soft.flac");
      await runFfmpeg({
        ffmpegPath: ffmpeg,
        args: ["-y", "-i", seq, "-af", fix.join(","), "-c:a", "flac", src],
        shouldCancel: () => isCancelled(db, job.id),
      });
    }
    const measured = await analyzeAudioFile(ctx, ffmpeg, src, [0.75, 0.85]);
    if (!measured.loudness) throw new JobError("MEASURE_FAILED", "Üretilen müzik ölçülemedi");
    const gain = gainToTarget(measured.loudness.input_i, measured.loudness.input_tp);
    const dir = assetDir(ctx.dataDir ?? ctx.outputDir, project.id);
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, `ai-${p.style}-${p.seed}.flac`);
    await runFfmpeg({
      ffmpegPath: ffmpeg,
      args: ["-y", "-i", src, "-af", `volume=${gain}dB`, "-ar", "48000", "-c:a", "flac", dest],
      shouldCancel: () => isCancelled(db, job.id),
    });
    const asset = await registerDerivedAsset(db, {
      projectId: project.id,
      filePath: dest,
      type: "audio",
      parentAssetId: null,
      source: `ai:${p.style}:${p.seed}:${status.model}`,
      originalName: `${AI_STYLES[p.style].label} · ${p.minutes} dk · #${p.seed}`,
    });
    upsertLicense(
      db,
      asset.id,
      licenseSchema.parse({
        provider: `Stable Audio 3 ${status.model} (Stability AI) — yapay zekâ ile üretildi`,
        licenseType:
          "Stability AI Community License (yıllık gelir 1 milyon $ altı ticari kullanım serbest) + Gemma kullanım şartları",
        termsVersion: "https://stability.ai/license",
        notes: `Otomatik kayıt. İstemler: ${items.map((i) => i.prompt).join(" || ")}`.slice(
          0,
          2000,
        ),
        reviewed: true,
      }),
    );
    const after = await analyzeAudioFile(ctx, ffmpeg, dest, [0.9, 0.99]);
    const comfort = await measureComfort(ffmpeg, dest, cls);
    if (comfort) after.comfort = comfort;
    updateAssetMeta(db, asset.id, { durationSec: after.durationSec, analysis: after });
    logJob(db, job.id, "info", `Hazır: ${asset.original_name}`);
    return { assetId: asset.id, ai: true };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
};
