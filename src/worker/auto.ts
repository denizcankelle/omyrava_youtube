import fs from "node:fs";
import path from "node:path";
import { getAsset } from "../lib/assets";
import { resolveFfmpegPath, runFfmpeg } from "../lib/ffmpeg";
import { SHORT_SEC, shortArgs, shortText } from "../lib/shorts";
import { tracklistText, trackNames } from "../lib/tracklist";
import { effectiveCrossfade } from "../lib/mix";
import { findFont } from "../lib/thumbnail";
import { aiStyleForCategory, isAiReady } from "../lib/ai";
import { isImageAiReady } from "../lib/aiimage";
import { RECIPES, randomSeed, thumbText } from "../lib/auto";
import { getConfig } from "../lib/config";
import { COVER_MAX_BYTES, cleanCoverArgs } from "../lib/cover";
import { audit } from "../lib/db";
import {
  type Job,
  JobError,
  isCancelled,
  logJob,
  setProgressScope,
  updateProgress,
} from "../lib/jobs";
import { categoryHashtags, suggestMetadata, withDarkScreen } from "../lib/metadata";
import { getProject, projectOutputDir } from "../lib/projects";
import {
  ensureMetadata,
  exportPackage,
  getMetadata,
  saveMetadata,
  setThumbnail,
} from "../lib/publish";
import { SCENES, type SceneId, pickFreshScene } from "../lib/scene";
import { VISUAL_PRESETS, type VisualPreset } from "../lib/visual";
import { type HandlerContext, type JobHandler, handlers } from "./handlers";

export interface AutoResult {
  audioAssetId: string;
  visualAssetId: string;
  stillAssetId: string;
  thumbnailAssetId: string;
  /** Bu varyasyonun metaverisi: secilirse tam renderdan once projeye uygulanir. */
  meta?: {
    language: "en" | "tr";
    title: string;
    description: string;
    tags: string[];
    aiGenerated: boolean;
  };
  /** Ek kapak varyasyonlari (pakette kapak-2.jpg, kapak-3.jpg). */
  thumbVariantIds?: string[];
  previewRenderId: string;
  notes: string[];
}

/** Ayni is kimligi ile baska bir is tipini calistirir; ilerlemeyi verilen araliga esler. */
async function step<T>(
  ctx: HandlerContext,
  type: string,
  payload: unknown,
  scope: { from: number; to: number; label: string },
): Promise<T> {
  const sub: Job = { ...ctx.job, type, payload: JSON.stringify(payload) };
  setProgressScope(ctx.job.id, scope);
  try {
    updateProgress(ctx.db, ctx.job.id, 0);
    return (await handlers[type]({ ...ctx, job: sub })) as T;
  } finally {
    setProgressScope(ctx.job.id, null);
  }
}

/**
 * Tek tus akis: kategoriye gore ses varyasyonlari + karisim, gorsel dongu, 2 dk onizleme,
 * kapak ve metaveri. Tam render kullanici onizlemeyi begenince ayri is olarak yapilir.
 */
export const autoProduce: JobHandler = async (ctx) => {
  const { db, job } = ctx;
  const {
    projectId,
    trackMinutes,
    useAi = true,
    useAiVisual = true,
    visual,
  } = JSON.parse(job.payload) as {
    projectId: string;
    /** Test/hizli mod icin parca suresi (dk). */
    trackMinutes?: number;
    /** Kuruluysa yapay zeka muzigi kullan. */
    useAi?: boolean;
    /** Kuruluysa yapay zeka gorseli kullan. */
    useAiVisual?: boolean;
    /** Gorsel turunu degistir (varsayilan: kategori tarifi). */
    visual?: VisualPreset;
  };
  const project = getProject(db, projectId);
  if (!project) throw new JobError("PROJECT_NOT_FOUND", "Proje bulunamadı", false);
  if (project.status === "cancelled")
    throw new JobError("PROJECT_CANCELLED", "Proje iptal edilmiş", false);
  const recipe = RECIPES[project.category];
  const notes: string[] = recipe.note ? [recipe.note] : [];
  if (recipe.note) logJob(db, job.id, "warn", recipe.note);

  // 1) Ses parcalari: once yapay zeka (kuruluysa ve kategori uygunsa), olmazsa besteci/sentez
  const audioIds: string[] = [];
  let usedAi = false;
  const aiStyle = aiStyleForCategory(project.category);
  const cfg = getConfig();
  if (useAi && aiStyle && isAiReady(ctx.aiDir ?? cfg.aiDir, ctx.aiPython ?? cfg.aiPython)) {
    try {
      const totalMin = trackMinutes ? trackMinutes * recipe.tracks.length : 30;
      const r = await step<{ assetId: string }>(
        ctx,
        "ai_music",
        { projectId, style: aiStyle, minutes: totalMin, seed: randomSeed() },
        { from: 0, to: 0.4, label: "Yapay zekâ müziği" },
      );
      audioIds.push(r.assetId);
      usedAi = true;
      notes.push(
        "Müzik Stable Audio 3 (yerel yapay zekâ) ile üretildi; açıklamada yapay zekâ beyanı var.",
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logJob(db, job.id, "warn", `Yapay zekâ müziği üretilemedi, besteciye geçildi: ${msg}`);
      notes.push(
        `Yapay zekâ müziği üretilemedi (${msg.slice(0, 160)}); yerleşik besteci kullanıldı.`,
      );
    }
  }
  const audioParts = [...(usedAi ? [] : recipe.tracks), ...(recipe.bed ? [recipe.bed] : [])];
  for (let i = 0; i < audioParts.length; i++) {
    const t = audioParts[i];
    const span = (usedAi ? 0.05 : 0.45) / audioParts.length;
    const from = (usedAi ? 0.4 : 0) + i * span;
    const minutes = trackMinutes ?? t.minutes;
    const isMusic = "music" in t;
    const r = await step<{ assetId: string }>(
      ctx,
      isMusic ? "music_compose" : "audio_generate",
      isMusic
        ? { projectId, style: t.music, minutes, seed: randomSeed() }
        : { projectId, preset: t.preset, minutes, seed: randomSeed() },
      { from, to: from + span, label: `Ses ${i + 1}/${audioParts.length}` },
    );
    audioIds.push(r.assetId);
  }
  const trackCount = usedAi ? 1 : recipe.tracks.length;
  const trackIds = audioIds.slice(0, trackCount);
  const bedId = recipe.bed ? audioIds.at(-1)! : null;

  // 2) Karisim
  const mix = await step<{ assetId: string }>(
    ctx,
    "audio_mix",
    {
      projectId,
      trackIds,
      crossfadeSec: recipe.crossfadeSec ?? 20,
      bedId,
      bedDb: recipe.bed?.db ?? -14,
      normalize: true,
    },
    { from: 0.45, to: 0.55, label: "Karışım" },
  );

  // 3) Gorsel: once yapay zeka sahnesi (kuruluysa), olmazsa yerlesik FFmpeg gorseli
  type Vis = { stillAssetId: string; loopAssetId: string; scene?: SceneId };
  let vis: Vis | null = null;
  const imgPython = ctx.imagePython ?? cfg.imagePython;
  if (useAiVisual && !visual && isImageAiReady(ctx.aiDir ?? cfg.aiDir, imgPython)) {
    const seed = randomSeed();
    try {
      vis = await step<Vis>(
        ctx,
        "ai_visual",
        {
          projectId,
          seed,
          scene: pickFreshScene(project.category, seed, recentScenes(db, project.category)),
        },
        { from: 0.55, to: 0.7, label: "Yapay zekâ görseli" },
      );
      notes.push(
        `Görsel yerel yapay zekâ (FLUX.1-schnell) ile üretildi: ${SCENES[vis.scene!].label}.`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logJob(
        db,
        job.id,
        "warn",
        `Yapay zekâ görseli üretilemedi, yerleşik görsele geçildi: ${msg}`,
      );
      notes.push(
        `Yapay zekâ görseli üretilemedi (${msg.slice(0, 160)}); yerleşik görsel kullanıldı.`,
      );
    }
  }
  if (!vis)
    vis = await step<Vis>(
      ctx,
      "visual_generate",
      { projectId, preset: visual ?? recipe.visual, seed: randomSeed() },
      { from: 0.55, to: 0.7, label: "Görüntü" },
    );
  const usedAiVisual = Boolean(vis.scene);

  // 4) Onizleme
  await step(
    ctx,
    "render_video",
    {
      projectId,
      audioAssetId: mix.assetId,
      visualAssetId: vis.loopAssetId,
      mode: "preview",
      motion: "none",
      seamless: false,
    },
    { from: 0.7, to: 0.9, label: "Önizleme" },
  );

  // 5) Metaveri ve kapak
  const meta = ensureMetadata(db, project);
  const lang = meta.language;
  const sceneInfo = vis.scene ? SCENES[vis.scene] : VISUAL_PRESETS[visual ?? recipe.visual];
  const scene = lang === "en" ? sceneInfo.en : sceneInfo.label;
  const d = suggestMetadata({
    category: recipe.metaCategory,
    durationSec: project.duration_sec,
    scene,
    lang,
    aiGenerated: usedAi || usedAiVisual,
    variant: categoryCount(db, project.category, projectId),
  });
  // Playlist turlerinde: parca adlari ve zaman damgali liste (YouTube bolumleri)
  if (recipe.playlist && !usedAi) {
    const durations = trackIds.map((id) => getAsset(db, id)?.duration_sec ?? 0);
    const xf = effectiveCrossfade(durations, recipe.crossfadeSec ?? 20);
    const list = tracklistText({
      names: trackNames(
        project.category,
        Number(job.id.replace(/\D/g, "").slice(0, 9)) || 1,
        durations.length,
      ),
      durations,
      crossfade: xf,
      videoSec: project.duration_sec,
      lang,
    });
    if (list) {
      const parts = d.description.split("\n\n");
      parts.splice(1, 0, list);
      d.description = parts.join("\n\n");
    }
  }
  saveMetadata(db, projectId, {
    language: lang,
    title: d.title,
    description: d.description,
    tags: d.tags,
    aiGenerated: usedAi || usedAiVisual,
  });
  const thumb = await step<{ assetId: string }>(
    ctx,
    "thumbnail_generate",
    { assetId: vis.stillAssetId, text: thumbText(recipe, project.duration_sec, lang) },
    { from: 0.9, to: 0.98, label: "Kapak" },
  );
  setThumbnail(db, projectId, thumb.assetId);
  // Iki farkli kapak duzeni daha: YouTube "Test & compare" ile denenebilir
  const thumbVariantIds: string[] = [];
  for (const variant of [1, 2]) {
    try {
      const t = await step<{ assetId: string }>(
        ctx,
        "thumbnail_generate",
        { assetId: vis.stillAssetId, text: thumbText(recipe, project.duration_sec, lang), variant },
        { from: 0.98, to: 0.99, label: "Kapak varyasyonu" },
      );
      thumbVariantIds.push(t.assetId);
    } catch (err) {
      logJob(db, job.id, "warn", `Kapak varyasyonu üretilemedi: ${(err as Error).message}`);
    }
  }
  // Ayni kategoride cok sik yukleme uyarisi (YouTube seri uretim kurali)
  const recent = db
    .prepare(
      `SELECT COUNT(*) AS n FROM project_metadata m JOIN projects p ON p.id = m.project_id
       WHERE p.category = ? AND p.id != ? AND m.packaged_at >= ?`,
    )
    .get(project.category, projectId, new Date(Date.now() - 48 * 3600 * 1000).toISOString()) as {
    n: number;
  };
  if (Number(recent.n) > 0)
    notes.push(
      "Aynı kategoride son 2 günde hazırlanmış başka video var. YouTube'un seri üretim kuralına takılmamak için yüklemeleri birkaç gün arayla yap.",
    );
  updateProgress(db, job.id, 0.99, "bitti");
  audit(db, "auto.produce", "project", projectId, { mix: mix.assetId, visual: vis.loopAssetId });
  logJob(db, job.id, "info", "Önizleme hazır. Beğenirsen “Tam render + yükleme paketi”ne bas.");
  const result: AutoResult = {
    audioAssetId: mix.assetId,
    visualAssetId: vis.loopAssetId,
    stillAssetId: vis.stillAssetId,
    thumbnailAssetId: thumb.assetId,
    thumbVariantIds,
    previewRenderId: job.id,
    meta: {
      language: lang,
      title: d.title,
      description: d.description,
      tags: d.tags,
      aiGenerated: usedAi || usedAiVisual,
    },
    notes,
  };
  return result;
};

/** Onizleme begenildikten sonra: tam sureli render + yukleme paketi. */
export const autoFinalize: JobHandler = async (ctx) => {
  const { db, job } = ctx;
  const {
    projectId,
    autoJobId,
    darkAfterMin = 0,
  } = JSON.parse(job.payload) as {
    projectId: string;
    autoJobId: string;
    /** Goruntu bu kadar dakika sonra kararir (0 = kapali). */
    darkAfterMin?: number;
  };
  const auto = db
    .prepare(
      "SELECT result FROM jobs WHERE id = ? AND type = 'auto_produce' AND status = 'succeeded'",
    )
    .get(autoJobId) as { result: string } | undefined;
  if (!auto) throw new JobError("NO_AUTO", "Önce otomatik hazırlık tamamlanmalı", false);
  const r = JSON.parse(auto.result) as AutoResult;
  if (!getAsset(db, r.audioAssetId) || !getAsset(db, r.visualAssetId))
    throw new JobError(
      "ASSET_MISSING",
      "Önizlemede kullanılan dosyalar silinmiş; yeniden hazırla",
      false,
    );

  // Secilen varyasyonun basligi/aciklamasi ve kapagi (varyasyonlar birbirinin uzerine yazmasin)
  if (r.meta) {
    const cur = getMetadata(db, projectId);
    saveMetadata(db, projectId, { ...r.meta, playlist: cur?.playlist ?? undefined });
  }
  if (getAsset(db, r.thumbnailAssetId)) setThumbnail(db, projectId, r.thumbnailAssetId);

  await step(
    ctx,
    "render_video",
    {
      projectId,
      audioAssetId: r.audioAssetId,
      visualAssetId: r.visualAssetId,
      mode: "full",
      motion: "none",
      seamless: false,
      darkAfterMin,
    },
    { from: 0, to: 0.9, label: "Tam render" },
  );
  if (darkAfterMin > 0) {
    const meta = getMetadata(db, projectId);
    if (meta) {
      const d = withDarkScreen(
        { title: meta.yt_title, description: meta.description, lang: meta.language },
        darkAfterMin,
      );
      saveMetadata(db, projectId, {
        language: meta.language,
        title: d.title,
        description: d.description,
        tags: JSON.parse(meta.tags) as string[],
        playlist: meta.playlist ?? undefined,
        aiGenerated: Boolean(meta.ai_generated),
      });
    }
  }
  updateProgress(db, job.id, 0.92, "paket");
  const pkg = exportPackage(db, ctx.outputDir, projectId);

  // Ek kapak varyasyonlari (YouTube "Test & compare" icin)
  for (const [i, id] of (r.thumbVariantIds ?? []).entries()) {
    const a = getAsset(db, id);
    if (a && fs.existsSync(a.file_path))
      fs.copyFileSync(a.file_path, path.join(pkg.dir, `kapak-${i + 2}.jpg`));
  }

  // Yazisiz 2K gorsel: kullanici bunu dogrudan kapak olarak yukleyebilir (YouTube siniri 2 MB)
  try {
    const still = getAsset(db, r.stillAssetId);
    if (still && fs.existsSync(still.file_path)) {
      const ff = resolveFfmpegPath(ctx.ffmpegPathSetting);
      const out = path.join(pkg.dir, "kapak-yazisiz-2k.jpg");
      for (const args of cleanCoverArgs(still.file_path, out)) {
        await runFfmpeg({ ffmpegPath: ff, args });
        if (fs.statSync(out).size <= COVER_MAX_BYTES) break;
      }
    }
  } catch (err) {
    logJob(
      db,
      job.id,
      "warn",
      `Yazısız kapak hazırlanamadı: ${err instanceof Error ? err.message : err}`,
    );
  }

  // Shorts: 30 sn dikey tanitim klibi (basarisiz olursa paket yine hazir)
  updateProgress(db, job.id, 0.95, "Shorts");
  try {
    const short = await makeShort(ctx, projectId, r);
    logJob(db, job.id, "info", `Shorts hazır: ${short}`);
  } catch (err) {
    logJob(db, job.id, "warn", `Shorts üretilemedi: ${err instanceof Error ? err.message : err}`);
  }
  logJob(db, job.id, "info", `Yükleme paketi hazır: ${pkg.dir}`);
  return { packageDir: pkg.dir, video: pkg.video };
};

/** Paket klasorune `short.mp4` + `short-baslik.txt`. */
async function makeShort(ctx: HandlerContext, projectId: string, r: AutoResult): Promise<string> {
  const { db, job } = ctx;
  const project = getProject(db, projectId)!;
  const meta = getMetadata(db, projectId)!;
  const loop = getAsset(db, r.visualAssetId)!;
  const audio = getAsset(db, r.audioAssetId)!;
  const dir = projectOutputDir(ctx.outputDir, project);
  const work = fs.mkdtempSync(path.join(ctx.dataDir ?? ctx.outputDir, "short-"));
  try {
    const recipe = RECIPES[project.category];
    const lines = thumbText(recipe, project.duration_sec, meta.language).split("\n");
    const t = shortText({
      title: meta.yt_title,
      lang: meta.language,
      hashtags: categoryHashtags(recipe.metaCategory, meta.language),
    });
    const font = findFont();
    if (font) {
      fs.copyFileSync(font, path.join(work, "font.ttf"));
      lines.slice(0, 2).forEach((l, i) => fs.writeFileSync(path.join(work, `line${i + 1}.txt`), l));
      fs.writeFileSync(path.join(work, "line3.txt"), t.note);
    }
    const dur = audio.duration_sec ?? 0;
    const start = dur > 200 ? 90 : Math.max(0, dur / 3);
    const out = path.join(dir, "short.mp4");
    await runFfmpeg({
      ffmpegPath: resolveFfmpegPath(ctx.ffmpegPathSetting),
      cwd: work,
      args: shortArgs({
        loop: loop.file_path,
        audio: audio.file_path,
        audioStartSec: start,
        output: out,
        titleLines: font ? Math.min(2, lines.length) : 0,
        withNote: Boolean(font),
      }),
      expectedDurationSec: SHORT_SEC,
      shouldCancel: () => isCancelled(db, job.id),
    });
    fs.writeFileSync(
      path.join(dir, "short-baslik.txt"),
      "\ufeff" + `BAŞLIK\n${t.title}\n\nAÇIKLAMA\n${t.description}\n`,
    );
    return out;
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

/** Ayni kategoride son kullanilan yapay zeka sahneleri (en yeni once). */
function recentScenes(db: HandlerContext["db"], category: string): string[] {
  const rows = db
    .prepare(
      `SELECT a.source FROM assets a JOIN projects p ON p.id = a.project_id
       WHERE p.category = ? AND a.source LIKE 'aivisual:%:loop' ORDER BY a.created_at DESC LIMIT 6`,
    )
    .all(category) as { source: string }[];
  return rows.map((r) => r.source.split(":")[1]);
}

/** Ayni kategorideki onceki proje sayisi: baslik sablonu bu sayiya gore doner. */
function categoryCount(db: HandlerContext["db"], category: string, projectId: string): number {
  const r = db
    .prepare(
      "SELECT COUNT(*) AS n FROM projects WHERE category = ? AND id != ? AND status != 'cancelled'",
    )
    .get(category, projectId) as { n: number };
  return Number(r.n);
}
