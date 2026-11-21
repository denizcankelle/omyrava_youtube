import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getAsset } from "../lib/assets";
import { fileEncoder } from "../lib/encoder";
import { audit, nowIso } from "../lib/db";
import { parseDuration, probeDurationSec, resolveFfmpegPath, runFfmpeg } from "../lib/ffmpeg";
import { JobError, isCancelled, logJob, updateProgress } from "../lib/jobs";
import { getProject, projectOutputDir, tryProjectStatus } from "../lib/projects";
import {
  type Manifest,
  type QaIssue,
  type Stage,
  PREVIEW_SECONDS,
  audioLoopArgs,
  estimateOutputBytes,
  DARK_FADE_SEC,
  blackArgs,
  darkConcatList,
  darkPlan,
  dims,
  fadeToBlackArgs,
  muxConcatArgs,
  evaluateFinal,
  evaluateLoopQa,
  fullAudioArgs,
  imagePrescaleArgs,
  muxArgs,
  parseLoopQa,
  qaLoopArgs,
  renderOptionsSchema,
  videoLoopFromImageArgs,
  videoLoopFromVideoArgs,
} from "../lib/render";
import type { HandlerContext, JobHandler } from "./handlers";

const RANGES: Record<Stage, [number, number]> = {
  video_loop: [0.01, 0.25],
  loop_qa: [0.25, 0.3],
  audio_loop: [0.3, 0.35],
  audio_full: [0.35, 0.8],
  mux: [0.8, 0.95],
  final_qa: [0.95, 0.99],
};

const STAGE_LABELS: Record<Stage, string> = {
  video_loop: "görüntü döngüsü",
  loop_qa: "döngü kontrolü",
  audio_loop: "ses döngüsü",
  audio_full: "ses (tam süre)",
  mux: "birleştirme",
  final_qa: "son kontrol",
};

function freeBytes(dir: string): number | null {
  try {
    const s = fs.statfsSync(dir);
    return Number(s.bavail) * Number(s.bsize);
  } catch {
    return null;
  }
}

function gb(n: number) {
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}

export const renderVideo: JobHandler = async (ctx: HandlerContext) => {
  const { db, job, outputDir, ffmpegPathSetting } = ctx;
  const parsed = renderOptionsSchema.safeParse(JSON.parse(job.payload));
  if (!parsed.success) throw new JobError("BAD_OPTIONS", "Render ayarları geçersiz", false);
  const opts = parsed.data;
  const project = getProject(db, opts.projectId);
  if (!project) throw new JobError("PROJECT_NOT_FOUND", "Proje bulunamadı", false);
  const audio = getAsset(db, opts.audioAssetId);
  const visual = getAsset(db, opts.visualAssetId);
  if (!audio || audio.type !== "audio")
    throw new JobError("NO_AUDIO", "Ses varlığı bulunamadı", false);
  if (!visual || !["image", "video_loop", "thumbnail"].includes(visual.type))
    throw new JobError("NO_VISUAL", "Görsel/video varlığı bulunamadı", false);
  for (const a of [audio, visual])
    if (!fs.existsSync(a.file_path))
      throw new JobError("FILE_MISSING", `Dosya yok: ${a.original_name}`, false);

  const full = opts.mode === "full";
  const { w: W, h: H } = dims(project.resolution);
  const res = project.resolution === "4k" ? "4k" : "1080p";
  const targetSec = full ? project.duration_sec : Math.min(PREVIEW_SECONDS, project.duration_sec);
  const ffmpeg = resolveFfmpegPath(ffmpegPathSetting);
  const dataDir = ctx.dataDir ?? path.join(outputDir, ".work");
  const workDir = path.join(dataDir, "renders", project.id, job.id);
  fs.mkdirSync(workDir, { recursive: true });
  const projectOut = projectOutputDir(outputDir, project);
  fs.mkdirSync(projectOut, { recursive: true });
  const outName = full
    ? `video-${(targetSec / 3600).toFixed(targetSec % 3600 ? 1 : 0)}saat-${job.id.slice(0, 6)}.mp4`
    : `onizleme-${job.id.slice(0, 6)}.mp4`;
  const outFile = path.join(projectOut, outName);

  db.prepare(
    `INSERT OR IGNORE INTO renders (id, project_id, profile, output_path, status, options, job_id)
     VALUES (?, ?, ?, ?, 'running', ?, ?)`,
  ).run(job.id, project.id, full ? `full_${res}` : `preview_${res}`, outFile, job.payload, job.id);
  db.prepare("UPDATE renders SET status = 'running' WHERE id = ?").run(job.id);
  if (full) {
    if (["draft", "qa_failed", "failed"].includes(project.status))
      tryProjectStatus(db, project.id, "queued");
    tryProjectStatus(db, project.id, "rendering");
  }

  // Asama durumu: is yeniden denenirse tamamlanmis asamalar atlanir.
  const manifestPath = path.join(workDir, "manifest.json");
  const key = createHash("sha256")
    .update([audio.checksum, visual.checksum, job.payload, targetSec].join("|"))
    .digest("hex");
  let manifest: Manifest = { key, done: {} };
  try {
    const m = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Manifest;
    if (m.key === key) manifest = m;
  } catch {
    // ilk calisma
  }
  const save = () => fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  const ff = (
    args: string[],
    expectedDurationSec: number | undefined,
    stage: Stage,
    stderrLimit?: number,
  ) => {
    const [a, b] = RANGES[stage];
    return runFfmpeg({
      ffmpegPath: ffmpeg,
      args,
      cwd: workDir,
      expectedDurationSec,
      stderrLimit,
      shouldCancel: () => isCancelled(db, job.id),
      onProgress: (f) => updateProgress(db, job.id, a + f * (b - a)),
    });
  };

  async function stage<T extends object>(name: Stage, fn: () => Promise<T>): Promise<T> {
    const prev = manifest.done[name];
    const prevFile = (prev?.data as { file?: string } | undefined)?.file;
    if (prev && (!prevFile || fs.existsSync(prevFile))) {
      logJob(db, job.id, "info", `Atlandı (önceden tamamlanmış): ${STAGE_LABELS[name]}`);
      return prev.data as T;
    }
    updateProgress(db, job.id, RANGES[name][0], STAGE_LABELS[name]);
    const started = Date.now();
    const data = await fn();
    manifest.done[name] = { at: nowIso(), data };
    save();
    logJob(
      db,
      job.id,
      "info",
      `${STAGE_LABELS[name]} tamam (${((Date.now() - started) / 1000).toFixed(0)} sn)`,
    );
    return data;
  }

  const warnings: QaIssue[] = [];
  try {
    // 1) Goruntu dongusu
    const loop = await stage("video_loop", async () => {
      const file = path.join(workDir, "loop.mp4");
      // Yerlesik/yapay zeka donguleri zaten kusursuz ve uygun kodlamada uretilir.
      const builtIn = /^(visual|aivisual):/.test(visual.source);
      if (visual.type === "video_loop") {
        const src = await probeDurationSec(ffmpeg, visual.file_path);
        if (!src || src < 2)
          throw new JobError("LOOP_TOO_SHORT", "Video döngü en az 2 sn olmalı", false);
        if (builtIn && visual.width === W && visual.height === H) {
          // Hedef cozunurlukte: yeniden kodlamadan dogrudan kullan (4K'da dakikalar kazandirir)
          fs.copyFileSync(visual.file_path, file);
        } else {
          await ff(
            videoLoopFromVideoArgs(visual.file_path, file, src, opts.seamless && !builtIn, W, H),
            src,
            "video_loop",
          );
        }
      } else {
        const pre = path.join(workDir, "prescaled.png");
        await ff(imagePrescaleArgs(visual.file_path, pre, W, H), undefined, "video_loop");
        await ff(
          videoLoopFromImageArgs(pre, file, opts.motion, 60, H),
          opts.motion === "drift" ? 60 : 10,
          "video_loop",
        );
      }
      const loopSec = await probeDurationSec(ffmpeg, file);
      if (!loopSec) throw new JobError("LOOP_FAILED", "Görüntü döngüsü oluşturulamadı");
      return { file, loopSec, bytes: fs.statSync(file).size };
    });

    // 2) Dongu kalite kontrolu (siyah kare, ani gecis)
    const loopQa = await stage("loop_qa", async () => {
      const { stderr } = await ff(qaLoopArgs(loop.file), loop.loopSec, "loop_qa", 2_000_000);
      return { issues: evaluateLoopQa(parseLoopQa(stderr), loop.loopSec) };
    });
    warnings.push(...loopQa.issues);
    const loopErrors = loopQa.issues.filter((i) => i.level === "error");
    if (loopErrors.length)
      throw new JobError("QA_FAILED", loopErrors.map((e) => e.message).join("; "), false);

    // 3) Ses dongusu (ses hedeften kisaysa)
    const aloop = await stage("audio_loop", async () => {
      const src = await probeDurationSec(ffmpeg, audio.file_path);
      if (!src) throw new JobError("AUDIO_UNREADABLE", "Ses süresi okunamadı", false);
      if (src >= targetSec) return { file: audio.file_path, loop: false, sourceSec: src };
      if (src < 8) throw new JobError("AUDIO_TOO_SHORT", "Ses en az 8 sn olmalı", false);
      const file = path.join(workDir, "audio-loop.flac");
      await ff(audioLoopArgs(audio.file_path, file, src), src, "audio_loop");
      return { file, loop: true, sourceSec: src };
    });
    if (aloop.loop && aloop.sourceSec < 600 && full)
      warnings.push({
        level: "warn",
        message: `Ses ${Math.round(aloop.sourceSec)} sn; ${Math.round(targetSec / aloop.sourceSec)} kez tekrarlanıyor. Daha uzun/çeşitli ses önerilir.`,
      });

    // Disk kontrolu
    const estimate = estimateOutputBytes(loop.bytes, loop.loopSec, targetSec);
    const needOut = estimate * 1.1;
    const needWork = (192_000 / 8) * targetSec * 1.1;
    const freeOut = freeBytes(projectOut);
    const freeWork = freeBytes(workDir);
    logJob(db, job.id, "info", `Tahmini çıktı boyutu: ${gb(estimate)}`);
    if (freeOut !== null && freeWork !== null) {
      const sameDisk =
        path.parse(path.resolve(projectOut)).root === path.parse(path.resolve(workDir)).root;
      const need = sameDisk ? needOut + needWork : needOut;
      if (freeOut < need || (!sameDisk && freeWork < needWork))
        throw new JobError(
          "DISK_FULL",
          `Yetersiz disk: gereken ~${gb(need)}, boş ${gb(Math.min(freeOut, freeWork))}`,
          false,
        );
    }

    // 4) Tam sureli ses
    const audioFull = await stage("audio_full", async () => {
      const file = path.join(workDir, "audio.m4a");
      await ff(fullAudioArgs(aloop.file, file, targetSec, aloop.loop), targetSec, "audio_full");
      return { file };
    });

    // 5) Birlestirme (video yeniden kodlanmaz)
    const dp = full ? darkPlan(opts.darkAfterMin, loop.loopSec, targetSec) : null;
    await stage("mux", async () => {
      const tmp = `${outFile}.part.mp4`;
      if (dp) {
        // Karanlik ekran: N dongu + 8 sn kararma + siyah; hepsi ayni kodlamada, -c copy ile birlesir
        // Ek parcalar donguyle AYNI kodlayiciyla kodlanmali (aksi halde -c copy birlestirme bozulur)
        const enc = fileEncoder(loop.file);
        await ff(
          fadeToBlackArgs(loop.file, path.join(workDir, "fade.mp4"), H, enc),
          undefined,
          "mux",
        );
        await ff(blackArgs(path.join(workDir, "black.mp4"), W, H, enc), undefined, "mux");
        const list = path.join(workDir, "video-list.txt");
        fs.writeFileSync(
          list,
          darkConcatList(dp, path.basename(loop.file), "fade.mp4", "black.mp4"),
        );
        logJob(
          db,
          job.id,
          "info",
          `Karanlık ekran: ${Math.round(dp.darkAtSec / 60)}. dakikada ${DARK_FADE_SEC} sn'de kararır`,
        );
        await ff(muxConcatArgs(list, audioFull.file, tmp, targetSec), targetSec, "mux");
      } else {
        await ff(muxArgs(loop.file, audioFull.file, tmp, targetSec), targetSec, "mux");
      }
      fs.renameSync(tmp, outFile);
      return { file: outFile };
    });

    // 6) Son kontrol
    const final = await stage("final_qa", async () => {
      const durationSec = await probeDurationSec(ffmpeg, outFile);
      const { stderr: info } = await runFfmpeg({
        ffmpegPath: ffmpeg,
        args: ["-i", outFile, "-t", "0.1", "-f", "null", "-"],
      }).catch(() => ({ stderr: "" }));
      const issues = evaluateFinal(info, targetSec, durationSec ?? parseDuration(info), W, H);
      // Dongu siniri ve son bolumde cozme hatasi var mi?
      for (const [ss, t] of [
        [Math.max(0, loop.loopSec - 2), 4],
        [Math.max(0, targetSec - 8), 8],
        ...(dp ? [[Math.max(0, dp.darkAtSec - 2), DARK_FADE_SEC + 6]] : []),
      ]) {
        const { stderr } = await runFfmpeg({
          ffmpegPath: ffmpeg,
          args: [
            "-v",
            "error",
            "-ss",
            ss.toFixed(3),
            "-i",
            outFile,
            "-t",
            String(t),
            "-f",
            "null",
            "-",
          ],
        });
        const errs = stderr
          .split(/\r?\n/)
          .filter(
            (l) =>
              l.trim() &&
              !/^(frame|fps|stream_|bitrate|total_size|out_time|dup_frames|drop_frames|speed|progress)/.test(
                l,
              ),
          );
        if (errs.length)
          issues.push({
            level: "warn",
            message: `Çözme uyarısı (${ss.toFixed(0)}. sn): ${errs[0].slice(0, 120)}`,
          });
      }
      return { durationSec, issues };
    });
    warnings.push(...final.issues);
    const finalErrors = final.issues.filter((i) => i.level === "error");
    if (finalErrors.length)
      throw new JobError("QA_FAILED", finalErrors.map((e) => e.message).join("; "), false);

    const size = fs.statSync(outFile).size;
    db.prepare(
      `UPDATE renders SET status = 'done', duration_sec = ?, size_bytes = ?, qa_status = 'passed',
         warnings = ?, finished_at = ?, output_path = ? WHERE id = ?`,
    ).run(final.durationSec, size, JSON.stringify(warnings), nowIso(), outFile, job.id);
    if (full) tryProjectStatus(db, project.id, "ready");
    audit(db, "render.done", "project", project.id, { outFile, mode: opts.mode });
    fs.rmSync(workDir, { recursive: true, force: true });
    logJob(db, job.id, "info", `Hazır: ${outFile} (${gb(size)})`);
    return {
      outputPath: outFile,
      durationSec: final.durationSec,
      sizeBytes: size,
      warnings: warnings.length,
    };
  } catch (err) {
    const retryable = err instanceof JobError ? err.retryable : true;
    const last = !retryable || job.attempts >= job.max_attempts || isCancelled(db, job.id);
    if (last) {
      const qa = err instanceof JobError && err.code === "QA_FAILED";
      db.prepare(
        `UPDATE renders SET status = ?, qa_status = ?, qa_notes = ?, warnings = ?, finished_at = ? WHERE id = ?`,
      ).run(
        isCancelled(db, job.id) ? "cancelled" : "failed",
        qa ? "failed" : "pending",
        (err as Error).message,
        JSON.stringify(warnings),
        nowIso(),
        job.id,
      );
      if (full) tryProjectStatus(db, project.id, qa ? "qa_failed" : "failed");
      fs.rmSync(`${outFile}.part.mp4`, { force: true });
    }
    throw err;
  }
};
