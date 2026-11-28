import {
  type ComfortClass,
  type ComfortResult,
  comfortArgs,
  comfortFix,
  evaluateComfort,
  parseComfort,
} from "../lib/comfort";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { type DB, audit } from "../lib/db";
import { parseDuration, probeDurationSec, resolveFfmpegPath, runFfmpeg } from "../lib/ffmpeg";
import { type Job, JobError, isCancelled, logJob, updateProgress } from "../lib/jobs";
import { getProject, safeFileName } from "../lib/projects";
import { getAsset, registerDerivedAsset, updateAssetMeta } from "../lib/assets";
import {
  type AudioAnalysis,
  type VisualAnalysis,
  AUDIO_RULES,
  buildNormalizeFilter,
  evaluateAudio,
  evaluateVisual,
  parseLoudnorm,
  parseSilences,
  parseVideoSize,
  parseVolumeDetect,
} from "../lib/media";
import { spawn } from "node:child_process";
import { renderVideo } from "./render";
import {
  THUMB_MAX_BYTES,
  findFont,
  normalizeThumbText,
  thumbFontSize,
  thumbnailArgs,
} from "../lib/thumbnail";

export interface HandlerContext {
  db: DB;
  job: Job;
  outputDir: string;
  /** Ara dosyalar icin (varsayilan: outputDir/.work). */
  dataDir?: string;
  /** Enstruman sesleri (SoundFont) yolu; verilmezse ayarlardan. */
  soundfontPath?: string;
  /** Yapay zeka: Python yorumlayicisi, ai klasoru ve kopru betigi (testte sahtesi verilir). */
  aiPython?: string;
  aiDir?: string;
  aiScript?: string;
  /** Yapay zeka gorsel: Python ve kopru betigi (testte sahtesi verilir). */
  imagePython?: string;
  imageScript?: string;
  ffmpegPathSetting: string | null;
}

export type JobHandler = (ctx: HandlerContext) => Promise<unknown>;

/**
 * Ornek render: 10 sn'lik 1080p test videosu (koyu arka plan + yumusak ton) uretir,
 * sureyi ve dosyayi kontrol eder. Uctan uca hattin (kuyruk -> worker -> FFmpeg -> QA) testi.
 */
const sampleRender: JobHandler = async ({ db, job, outputDir, ffmpegPathSetting }) => {
  const payload = JSON.parse(job.payload) as { seconds?: number };
  const seconds = Math.min(Math.max(payload.seconds ?? 10, 2), 60);
  const project = job.project_id ? getProject(db, job.project_id) : undefined;
  const folderName = project
    ? `${safeFileName(project.title)}-${project.id.slice(0, 8)}`
    : "ornek-isler";
  const dir = path.join(outputDir, folderName);
  fs.mkdirSync(dir, { recursive: true });
  const outFile = path.join(dir, `ornek-test-${job.id.slice(0, 8)}.mp4`);
  const tmpFile = `${outFile}.part.mp4`;

  const ffmpeg = resolveFfmpegPath(ffmpegPathSetting);
  logJob(db, job.id, "info", `FFmpeg: ${ffmpeg}`);
  updateProgress(db, job.id, 0.02, "render");

  await runFfmpeg({
    ffmpegPath: ffmpeg,
    expectedDurationSec: seconds,
    shouldCancel: () => isCancelled(db, job.id),
    onProgress: (f) => updateProgress(db, job.id, 0.05 + f * 0.85),
    args: [
      "-y",
      "-f",
      "lavfi",
      "-i",
      `color=c=0x0b1026:s=1920x1080:r=30:d=${seconds}`,
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=174:sample_rate=48000:duration=${seconds}`,
      "-af",
      `volume=0.2,afade=t=in:d=1,afade=t=out:st=${seconds - 1}:d=1`,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-movflags",
      "+faststart",
      "-shortest",
      tmpFile,
    ],
  });

  updateProgress(db, job.id, 0.92, "qa");
  const duration = await probeDurationSec(ffmpeg, tmpFile);
  const size = fs.statSync(tmpFile).size;
  const problems: string[] = [];
  if (size <= 0) problems.push("dosya bos");
  if (duration === null) problems.push("sure okunamadi");
  else if (Math.abs(duration - seconds) > 0.5)
    problems.push(`sure uyumsuz: ${duration.toFixed(2)} sn (beklenen ${seconds})`);
  if (problems.length) {
    fs.rmSync(tmpFile, { force: true });
    throw new JobError("QA_FAILED", problems.join("; "));
  }
  fs.renameSync(tmpFile, outFile);

  if (project) {
    db.prepare(
      `INSERT INTO renders (id, project_id, profile, output_path, duration_sec, size_bytes, qa_status)
       VALUES (?, ?, 'sample_1080p', ?, ?, ?, 'passed')`,
    ).run(randomUUID(), project.id, outFile, duration, size);
  }
  audit(db, "render.sample", "job", job.id, { outFile });
  logJob(
    db,
    job.id,
    "info",
    `Tamamlandi: ${outFile} (${(size / 1024).toFixed(0)} KB, ${duration} sn)`,
  );
  return { outputPath: outFile, durationSec: duration, sizeBytes: size };
};

/** `ffmpeg -i` bilgisini (sure, boyut) okur. */
function ffmpegInfo(ffmpeg: string, file: string): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn(ffmpeg, ["-hide_banner", "-i", file], { windowsHide: true });
    let err = "";
    child.stderr.on("data", (c: Buffer) => (err += c.toString()));
    child.on("error", () => resolve(""));
    child.on("close", () => resolve(err));
  });
}

/** Rahatlik olcumu (sertlik/tizlik); `pre` verilirse o zincirden sonraki ses olculur. */
export async function measureComfort(
  ffmpeg: string,
  file: string,
  cls: ComfortClass,
  pre?: string,
): Promise<ComfortResult | null> {
  try {
    const { stderr } = await runFfmpeg({
      ffmpegPath: ffmpeg,
      args: comfortArgs(file, pre),
      stderrLimit: 200_000,
    });
    const m = parseComfort(stderr);
    return m ? evaluateComfort(m, cls) : null;
  } catch {
    return null;
  }
}

/**
 * Rahatlik duzeltmesi: olc, gerekiyorsa EQ ekle, tekrar olc (en fazla 3 tur). Genis bantli
 * seslerde (yagmur) tek tur yetmeyebilir. Donen filtreler `pre` zincirinin ARDINA eklenir.
 */
export async function solveComfort(
  ffmpeg: string,
  file: string,
  cls: ComfortClass,
  pre?: string,
): Promise<{ first: ComfortResult | null; fix: string[] }> {
  const fix: string[] = [];
  let first: ComfortResult | null = null;
  for (let round = 0; round < 3; round++) {
    const chain = [pre, ...fix].filter(Boolean).join(",") || undefined;
    const m = await measureComfort(ffmpeg, file, cls, chain);
    if (round === 0) first = m;
    if (!m || m.ok) break;
    const add = comfortFix(m, cls);
    if (!add.length) break;
    fix.push(...add);
  }
  return { first, fix };
}

export async function analyzeAudioFile(
  ctx: HandlerContext,
  ffmpeg: string,
  file: string,
  progressSpan: [number, number],
): Promise<AudioAnalysis> {
  const { db, job } = ctx;
  const durationSec = await probeDurationSec(ffmpeg, file);
  const r = AUDIO_RULES;
  const { stderr } = await runFfmpeg({
    ffmpegPath: ffmpeg,
    expectedDurationSec: durationSec ?? undefined,
    shouldCancel: () => isCancelled(db, job.id),
    onProgress: (f) =>
      updateProgress(db, job.id, progressSpan[0] + f * (progressSpan[1] - progressSpan[0])),
    stderrLimit: 2_000_000,
    args: [
      "-i",
      file,
      "-vn",
      "-af",
      `silencedetect=n=${r.silenceThresholdDb}dB:d=${r.silenceMinSec},volumedetect,` +
        `loudnorm=I=${r.targetLufs}:TP=${r.targetTp}:LRA=${r.targetLra}:print_format=json`,
      "-f",
      "null",
      "-",
    ],
  });
  const vol = parseVolumeDetect(stderr);
  const base = {
    durationSec,
    loudness: parseLoudnorm(stderr),
    meanVolumeDb: vol.mean,
    maxVolumeDb: vol.max,
    clippedSamples: vol.clipped,
    silences: parseSilences(stderr, durationSec),
  };
  return { kind: "audio", ...base, warnings: evaluateAudio(base) };
}

/** Varlik analizi: ses icin seviye/clipping/sessizlik, gorsel/video icin boyut ve oran. */
const assetAnalyze: JobHandler = async (ctx) => {
  const { db, job, ffmpegPathSetting } = ctx;
  const { assetId } = JSON.parse(job.payload) as { assetId: string };
  const asset = getAsset(db, assetId);
  if (!asset) throw new JobError("ASSET_NOT_FOUND", "Varlık bulunamadı", false);
  if (!fs.existsSync(asset.file_path))
    throw new JobError("FILE_MISSING", `Dosya yok: ${asset.file_path}`, false);
  const ffmpeg = resolveFfmpegPath(ffmpegPathSetting);
  updateProgress(db, job.id, 0.02, "analiz");

  if (asset.type === "audio") {
    const analysis = await analyzeAudioFile(ctx, ffmpeg, asset.file_path, [0.05, 0.98]);
    updateAssetMeta(db, asset.id, { durationSec: analysis.durationSec, analysis });
    logJob(db, job.id, "info", `Ses analizi bitti: ${analysis.warnings.length} uyarı`);
    return { warnings: analysis.warnings.length, loudness: analysis.loudness?.input_i ?? null };
  }

  if (asset.type === "other") {
    updateAssetMeta(db, asset.id, { analysis: null });
    return { skipped: true };
  }

  const info = await ffmpegInfo(ffmpeg, asset.file_path);
  const size = parseVideoSize(info);
  const durationSec = asset.type === "video_loop" ? parseDuration(info) : null;
  const base = {
    width: size?.width ?? null,
    height: size?.height ?? null,
    durationSec,
    sizeBytes: asset.size_bytes,
  };
  const analysis: VisualAnalysis = {
    kind: "visual",
    ...base,
    warnings: evaluateVisual(asset.type, base),
  };
  updateAssetMeta(db, asset.id, { ...base, analysis });
  logJob(db, job.id, "info", `Görsel analizi bitti: ${base.width}x${base.height}`);
  return { warnings: analysis.warnings.length, width: base.width, height: base.height };
};

/** Iki gecisli loudness normalizasyonu + fade-in/out. Sonuc yeni bir FLAC varligi olur. */
const audioNormalize: JobHandler = async (ctx) => {
  const { db, job, ffmpegPathSetting } = ctx;
  const { assetId } = JSON.parse(job.payload) as { assetId: string };
  const asset = getAsset(db, assetId);
  if (!asset) throw new JobError("ASSET_NOT_FOUND", "Varlık bulunamadı", false);
  if (asset.type !== "audio") throw new JobError("NOT_AUDIO", "Sadece ses normalize edilir", false);
  const ffmpeg = resolveFfmpegPath(ffmpegPathSetting);

  updateProgress(db, job.id, 0.01, "ölçüm");
  const measured = await analyzeAudioFile(ctx, ffmpeg, asset.file_path, [0.02, 0.45]);
  if (!measured.loudness || !measured.durationSec)
    throw new JobError("MEASURE_FAILED", "Ses ölçülemedi; dosya sessiz veya bozuk", false);

  const dir = path.dirname(asset.file_path);
  const base = path.basename(asset.file_path, path.extname(asset.file_path));
  const outFile = path.join(dir, `${base}-norm-${job.id.slice(0, 6)}.flac`);
  const tmpFile = `${outFile}.part.flac`;
  updateProgress(db, job.id, 0.46, "normalizasyon");
  await runFfmpeg({
    ffmpegPath: ffmpeg,
    expectedDurationSec: measured.durationSec,
    shouldCancel: () => isCancelled(db, job.id),
    onProgress: (f) => updateProgress(db, job.id, 0.46 + f * 0.4),
    args: [
      "-y",
      "-i",
      asset.file_path,
      "-vn",
      "-af",
      buildNormalizeFilter(measured.loudness, measured.durationSec),
      "-ar",
      "48000",
      "-c:a",
      "flac",
      tmpFile,
    ],
  });
  fs.renameSync(tmpFile, outFile);

  updateProgress(db, job.id, 0.87, "kontrol");
  const derived = await registerDerivedAsset(db, {
    projectId: asset.project_id,
    filePath: outFile,
    type: "audio",
    parentAssetId: asset.id,
    source: `normalize:${asset.id}`,
    originalName: `${asset.original_name ?? base} (normalize)`,
  });
  const after = await analyzeAudioFile(ctx, ffmpeg, outFile, [0.88, 0.99]);
  updateAssetMeta(db, derived.id, { durationSec: after.durationSec, analysis: after });
  logJob(
    db,
    job.id,
    "info",
    `Normalize edildi: ${measured.loudness.input_i.toFixed(1)} → ${after.loudness?.input_i.toFixed(1)} LUFS`,
  );
  return {
    assetId: derived.id,
    outputPath: outFile,
    before: measured.loudness.input_i,
    after: after.loudness?.input_i ?? null,
  };
};

/** Kapak: secilen gorsel/video karesinden 1280x720 JPG, istege bagli yazi; en fazla 2 MB. */
const thumbnailGenerate: JobHandler = async (ctx) => {
  const { db, job, ffmpegPathSetting, outputDir } = ctx;
  const { assetId, text, variant } = JSON.parse(job.payload) as {
    assetId: string;
    text?: string;
    variant?: number;
  };
  const src = getAsset(db, assetId);
  if (!src || !["image", "video_loop", "thumbnail"].includes(src.type))
    throw new JobError("NO_SOURCE", "Kaynak görsel bulunamadı", false);
  const ffmpeg = resolveFfmpegPath(ffmpegPathSetting);
  const lines = normalizeThumbText(text ?? "");
  const work = fs.mkdtempSync(path.join(ctx.dataDir ?? outputDir, "thumb-"));
  try {
    let withText = false;
    if (lines.length) {
      const font = findFont();
      if (!font) logJob(db, job.id, "warn", "Yazı tipi bulunamadı; kapak yazısız üretildi");
      else {
        fs.copyFileSync(font, path.join(work, "font.ttf"));
        lines.forEach((l, i) => fs.writeFileSync(path.join(work, `line${i + 1}.txt`), l));
        withText = true;
      }
    }
    const tmp = path.join(work, "kapak.jpg");
    let size = Infinity;
    for (const quality of [2, 3, 5, 8]) {
      await runFfmpeg({
        ffmpegPath: ffmpeg,
        cwd: work,
        args: thumbnailArgs({
          source: src.file_path,
          isVideo: src.type === "video_loop",
          output: "kapak.jpg",
          lineCount: withText ? lines.length : 0,
          fontSize: thumbFontSize(lines),
          quality,
          variant,
        }),
      });
      size = fs.statSync(tmp).size;
      if (size <= THUMB_MAX_BYTES) break;
    }
    if (size > THUMB_MAX_BYTES)
      throw new JobError("THUMB_TOO_BIG", "Kapak 2 MB altına indirilemedi", false);
    const dir = path.dirname(src.file_path);
    const dest = path.join(dir, `kapak-${job.id.slice(0, 8)}.jpg`);
    fs.copyFileSync(tmp, dest);
    const asset = await registerDerivedAsset(db, {
      projectId: src.project_id,
      filePath: dest,
      type: "thumbnail",
      parentAssetId: src.parent_asset_id ?? src.id,
      source: variant ? `thumbnail:${src.id}:v${variant}` : `thumbnail:${src.id}`,
      originalName: lines.length ? `Kapak: ${lines.join(" / ")}` : "Kapak",
    });
    updateAssetMeta(db, asset.id, {
      width: 1280,
      height: 720,
      analysis: {
        kind: "visual",
        width: 1280,
        height: 720,
        durationSec: null,
        sizeBytes: size,
        warnings: evaluateVisual("thumbnail", {
          width: 1280,
          height: 720,
          durationSec: null,
          sizeBytes: size,
        }),
      },
    });
    logJob(db, job.id, "info", `Kapak hazır (${Math.round(size / 1024)} KB)`);
    return { assetId: asset.id, sizeBytes: size };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
};

export const handlers: Record<string, JobHandler> = {
  audio_generate: (ctx) => import("./audio").then((m) => m.audioGenerate(ctx)),
  audio_mix: (ctx) => import("./audio").then((m) => m.audioMix(ctx)),
  ai_music: (ctx) => import("./aimusic").then((m) => m.aiMusic(ctx)),
  music_compose: (ctx) => import("./music").then((m) => m.musicCompose(ctx)),
  visual_generate: (ctx) => import("./visual").then((m) => m.visualGenerate(ctx)),
  ai_visual: (ctx) => import("./aivisual").then((m) => m.aiVisual(ctx)),
  auto_produce: (ctx) => import("./auto").then((m) => m.autoProduce(ctx)),
  auto_finalize: (ctx) => import("./auto").then((m) => m.autoFinalize(ctx)),
  thumbnail_generate: thumbnailGenerate,
  sample_render: sampleRender,
  asset_analyze: assetAnalyze,
  audio_normalize: audioNormalize,
  render_video: renderVideo,
};
