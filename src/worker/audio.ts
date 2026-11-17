import { LIMITER, masterPreChain } from "@/lib/mastering";
import fs from "node:fs";
import path from "node:path";
import {
  assetDir,
  getAsset,
  getLicense,
  licenseSchema,
  registerDerivedAsset,
  updateAssetMeta,
  upsertLicense,
} from "../lib/assets";
import { probeDurationSec, resolveFfmpegPath, runFfmpeg } from "../lib/ffmpeg";
import { JobError, isCancelled, logJob, updateProgress } from "../lib/jobs";
import { buildNormalizeFilter } from "../lib/media";
import { bedArgs, effectiveCrossfade, mixSchema, sequenceArgs, sequenceDuration } from "../lib/mix";
import { getProject } from "../lib/projects";
import { audioLoopArgs } from "../lib/render";
import { SYNTH_PRESETS, type SynthPreset, buildSynthPlan, gainToTarget } from "../lib/synth";
import { type HandlerContext, type JobHandler, analyzeAudioFile } from "./handlers";

function workDirFor(ctx: HandlerContext, name: string) {
  const dir = path.join(ctx.dataDir ?? ctx.outputDir, "work", `${name}-${ctx.job.id.slice(0, 8)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Yerlesik sentez: uret -> olc -> hedef seviyeye kazanc -> FLAC varlik + otomatik lisans kaydi. */
export const audioGenerate: JobHandler = async (ctx) => {
  const { db, job, ffmpegPathSetting } = ctx;
  const p = JSON.parse(job.payload) as {
    projectId: string;
    preset: SynthPreset;
    minutes: number;
    seed: number;
  };
  if (!(p.preset in SYNTH_PRESETS)) throw new JobError("BAD_PRESET", "Geçersiz ses türü", false);
  const project = getProject(db, p.projectId);
  if (!project) throw new JobError("PROJECT_NOT_FOUND", "Proje bulunamadı", false);
  const ffmpeg = resolveFfmpegPath(ffmpegPathSetting);
  const durationSec = Math.round(p.minutes * 60);
  const work = workDirFor(ctx, "gen");
  const cancel = () => isCancelled(db, job.id);
  try {
    const raw = path.join(work, "raw.flac");
    const plan = buildSynthPlan(p.preset, p.seed, durationSec, raw);
    logJob(db, job.id, "info", plan.description);
    updateProgress(db, job.id, 0.02, "sentez");
    await runFfmpeg({
      ffmpegPath: ffmpeg,
      args: plan.args,
      expectedDurationSec: durationSec,
      shouldCancel: cancel,
      onProgress: (f) => updateProgress(db, job.id, 0.02 + f * 0.6),
    });

    updateProgress(db, job.id, 0.63, "ölçüm");
    const measured = await analyzeAudioFile(ctx, ffmpeg, raw, [0.63, 0.8]);
    if (!measured.loudness) throw new JobError("MEASURE_FAILED", "Üretilen ses ölçülemedi");
    const gain = gainToTarget(measured.loudness.input_i, measured.loudness.input_tp);

    const dir = assetDir(ctx.dataDir ?? ctx.outputDir, project.id);
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, `${p.preset}-${p.seed}.flac`);
    updateProgress(db, job.id, 0.8, "seviye");
    await runFfmpeg({
      ffmpegPath: ffmpeg,
      args: ["-y", "-i", raw, "-af", `volume=${gain}dB`, "-c:a", "flac", dest],
      expectedDurationSec: durationSec,
      shouldCancel: cancel,
      onProgress: (f) => updateProgress(db, job.id, 0.8 + f * 0.1),
    });

    const asset = await registerDerivedAsset(db, {
      projectId: project.id,
      filePath: dest,
      type: "audio",
      parentAssetId: null,
      source: `generated:${p.preset}:${p.seed}`,
      originalName: `${SYNTH_PRESETS[p.preset].label} · ${p.minutes} dk · #${p.seed}`,
    });
    upsertLicense(
      db,
      asset.id,
      licenseSchema.parse({
        provider: "Omyrava Studio — yerleşik üretim (FFmpeg sentezi)",
        licenseType: "Kendi üretimim; yapay zekâ kullanılmadı",
        notes: `Otomatik kayıt. ${plan.description}. Seed ${p.seed}.`,
        reviewed: true,
      }),
    );
    const after = await analyzeAudioFile(ctx, ffmpeg, dest, [0.9, 0.99]);
    updateAssetMeta(db, asset.id, { durationSec: after.durationSec, analysis: after });
    logJob(db, job.id, "info", `Hazır: ${asset.original_name} (${gain >= 0 ? "+" : ""}${gain} dB)`);
    return { assetId: asset.id, gainDb: gain };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
};

/** Cok parcali karisim: sirala + capraz gecis, istege bagli alt katman, normalize. */
export const audioMix: JobHandler = async (ctx) => {
  const { db, job, ffmpegPathSetting } = ctx;
  const parsed = mixSchema.safeParse(JSON.parse(job.payload));
  if (!parsed.success) throw new JobError("BAD_OPTIONS", "Karışım ayarları geçersiz", false);
  const o = parsed.data;
  const project = getProject(db, o.projectId);
  if (!project) throw new JobError("PROJECT_NOT_FOUND", "Proje bulunamadı", false);

  const ids = o.bedId ? [...o.trackIds, o.bedId] : o.trackIds;
  const assets = ids.map((id) => getAsset(db, id));
  for (const a of assets) {
    if (!a || a.project_id !== project.id || a.type !== "audio")
      throw new JobError("BAD_TRACK", "Parçalardan biri bu projede bulunamadı", false);
    if (!fs.existsSync(a.file_path))
      throw new JobError("FILE_MISSING", `Dosya yok: ${a.original_name}`, false);
    if (!getLicense(db, a.parent_asset_id ?? a.id)?.reviewed_at)
      throw new JobError("UNLICENSED", `Lisansı onaylanmamış: ${a.original_name}`, false);
  }
  const tracks = o.trackIds.map((id) => getAsset(db, id)!);
  const bed = o.bedId ? getAsset(db, o.bedId)! : null;

  const ffmpeg = resolveFfmpegPath(ffmpegPathSetting);
  const work = workDirFor(ctx, "mix");
  const cancel = () => isCancelled(db, job.id);
  try {
    const durations: number[] = [];
    for (const t of tracks) {
      const d = await probeDurationSec(ffmpeg, t.file_path);
      if (!d) throw new JobError("AUDIO_UNREADABLE", `Süre okunamadı: ${t.original_name}`, false);
      durations.push(d);
    }
    const xf = effectiveCrossfade(durations, o.crossfadeSec);
    const total = sequenceDuration(durations, xf);
    logJob(
      db,
      job.id,
      "info",
      `${tracks.length} parça, ${xf.toFixed(1)} sn geçiş, toplam ${(total / 60).toFixed(1)} dk`,
    );

    const seq = path.join(work, "seq.flac");
    updateProgress(db, job.id, 0.02, "sıralama");
    await runFfmpeg({
      ffmpegPath: ffmpeg,
      args: sequenceArgs(
        tracks.map((t) => t.file_path),
        xf,
        seq,
      ),
      expectedDurationSec: total,
      shouldCancel: cancel,
      onProgress: (f) => updateProgress(db, job.id, 0.02 + f * 0.35),
    });

    let current = seq;
    if (bed) {
      const layered = path.join(work, "layered.flac");
      updateProgress(db, job.id, 0.38, "alt katman");
      // Alt katman tekrar ederken dikis (tik / akor sicramasi) olmasin: once kendi icinde
      // capraz gecisli, kesintisiz donen bir surume cevrilir.
      let bedFile = bed.file_path;
      const bedDur = await probeDurationSec(ffmpeg, bed.file_path);
      if (bedDur && bedDur < total && bedDur > 8) {
        bedFile = path.join(work, "bed-loop.flac");
        await runFfmpeg({
          ffmpegPath: ffmpeg,
          args: audioLoopArgs(bed.file_path, bedFile, bedDur),
          expectedDurationSec: bedDur,
          shouldCancel: cancel,
        });
      }
      await runFfmpeg({
        ffmpegPath: ffmpeg,
        args: bedArgs(seq, bedFile, o.bedDb, layered),
        expectedDurationSec: total,
        shouldCancel: cancel,
        onProgress: (f) => updateProgress(db, job.id, 0.38 + f * 0.17),
      });
      current = layered;
    }

    const dir = assetDir(ctx.dataDir ?? ctx.outputDir, project.id);
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, `mix-${job.id.slice(0, 8)}.flac`);
    if (o.normalize) {
      // 1) Kategori on zinciri: EQ, stereo daraltma, yumusak kompresor
      const pre = path.join(work, "pre.flac");
      updateProgress(db, job.id, 0.56, "mastering");
      await runFfmpeg({
        ffmpegPath: ffmpeg,
        args: [
          "-y",
          "-i",
          current,
          "-af",
          masterPreChain(project.category),
          "-ar",
          "48000",
          "-c:a",
          "flac",
          pre,
        ],
        expectedDurationSec: total,
        shouldCancel: cancel,
        onProgress: (f) => updateProgress(db, job.id, 0.56 + f * 0.14),
      });
      // 2) Olcum + iki gecisli loudnorm (-18 LUFS / -2 dBTP / LRA 4) + limiter
      const m = await analyzeAudioFile(ctx, ffmpeg, pre, [0.7, 0.78]);
      if (!m.loudness || !m.durationSec) throw new JobError("MEASURE_FAILED", "Karışım ölçülemedi");
      updateProgress(db, job.id, 0.78, "normalizasyon");
      await runFfmpeg({
        ffmpegPath: ffmpeg,
        args: [
          "-y",
          "-i",
          pre,
          "-af",
          `${buildNormalizeFilter(m.loudness, m.durationSec, { fadeInSec: 0, fadeOutSec: 0 })},aresample=48000,${LIMITER}`,
          "-ar",
          "48000",
          "-sample_fmt",
          "s32",
          "-c:a",
          "flac",
          dest,
        ],
        expectedDurationSec: m.durationSec,
        shouldCancel: cancel,
        onProgress: (f) => updateProgress(db, job.id, 0.78 + f * 0.14),
      });
    } else {
      fs.copyFileSync(current, dest);
    }

    const name = `Karışım: ${tracks.length} parça${bed ? " + alt katman" : ""} · ${(total / 60).toFixed(0)} dk`;
    const asset = await registerDerivedAsset(db, {
      projectId: project.id,
      filePath: dest,
      type: "audio",
      parentAssetId: null,
      source: `mix:${ids.join(",")}`,
      originalName: name,
    });
    const sources = assets.map((a) => {
      const lic = getLicense(db, a!.parent_asset_id ?? a!.id)!;
      return `${a!.original_name} (${lic.provider})`;
    });
    upsertLicense(
      db,
      asset.id,
      licenseSchema.parse({
        provider: "Karışım — kaynakların lisansları geçerli",
        licenseType: "Lisansı onaylı parçalardan türetildi",
        notes: `Kaynaklar: ${sources.join("; ")}`.slice(0, 2000),
        reviewed: true,
      }),
    );
    const after = await analyzeAudioFile(ctx, ffmpeg, dest, [0.9, 0.99]);
    updateAssetMeta(db, asset.id, { durationSec: after.durationSec, analysis: after });
    logJob(db, job.id, "info", `Hazır: ${name}`);
    return { assetId: asset.id, durationSec: after.durationSec };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
};
