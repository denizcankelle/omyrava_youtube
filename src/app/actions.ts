"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { cancelJob, enqueueJob } from "@/lib/jobs";
import {
  ApprovalBlockedError,
  CATEGORIES,
  createProject,
  createProjectSchema,
  setProjectStatus,
} from "@/lib/projects";
import { getConfig } from "@/lib/config";
import {
  AssetError,
  deleteAsset,
  getAsset,
  getLicense,
  importAssetFromPath,
  licenseSchema,
  upsertLicense,
} from "@/lib/assets";
import { isProjectStatus } from "@/lib/status";
import { renderOptionsSchema } from "@/lib/render";
import { synthSchema } from "@/lib/synth";
import { MUSIC_STYLES } from "@/lib/composer";
import { AI_STYLES, isAiReady } from "@/lib/ai";
import { isImageAiReady } from "@/lib/aiimage";
import { SCENES } from "@/lib/scene";
import { visualSchema } from "@/lib/visual";
import { addStat, statSchema } from "@/lib/stats";
import { backupDb, cleanup } from "@/lib/maintenance";
import { mixSchema } from "@/lib/mix";
import { metadataSchema, parseTags, suggestMetadata } from "@/lib/metadata";
import {
  PublishError,
  ensureMetadata,
  exportPackage,
  recordUpload,
  saveMetadata,
  setThumbnail,
} from "@/lib/publish";
import { getProject } from "@/lib/projects";

export type FormState = { error?: string };

export async function createProjectAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = createProjectSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => i.message).join(", ") };
  }
  const db = getDb();
  const project = createProject(db, parsed.data);
  if (formData.get("autoStart") === "on") {
    enqueueJob(db, {
      type: "auto_produce",
      projectId: project.id,
      payload: { projectId: project.id, useAi: formData.get("useAi") === "on" },
      maxAttempts: 1,
    });
  }
  redirect(`/projects/${project.id}`);
}

export async function enqueueSampleAction(formData: FormData) {
  const projectId = String(formData.get("projectId"));
  enqueueJob(getDb(), { type: "sample_render", projectId, payload: { seconds: 10 } });
  revalidatePath(`/projects/${projectId}`);
}

export async function cancelJobAction(formData: FormData) {
  const jobId = String(formData.get("jobId"));
  const projectId = String(formData.get("projectId"));
  cancelJob(getDb(), jobId);
  revalidatePath(`/projects/${projectId}`);
}

export async function setStatusAction(formData: FormData) {
  const projectId = String(formData.get("projectId"));
  const to = String(formData.get("to"));
  if (!isProjectStatus(to)) throw new Error("Gecersiz durum");
  try {
    setProjectStatus(getDb(), projectId, to);
  } catch (err) {
    if (err instanceof ApprovalBlockedError) {
      redirect(`/projects/${projectId}?error=${encodeURIComponent(err.message)}`);
    }
    throw err;
  }
  revalidatePath("/");
  redirect(`/projects/${projectId}`);
}

export async function importAssetAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const projectId = String(formData.get("projectId"));
  const db = getDb();
  try {
    const asset = await importAssetFromPath(db, getConfig().dataDir, {
      projectId,
      sourcePath: String(formData.get("sourcePath") ?? ""),
      requestedType: formData.get("asThumbnail") === "on" ? "thumbnail" : null,
    });
    enqueueJob(db, { type: "asset_analyze", projectId, payload: { assetId: asset.id } });
  } catch (err) {
    if (err instanceof AssetError) return { error: err.message };
    throw err;
  }
  revalidatePath(`/projects/${projectId}`);
  return {};
}

export async function saveLicenseAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const assetId = String(formData.get("assetId"));
  const parsed = licenseSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues.map((i) => i.message).join(", ") };
  const db = getDb();
  const asset = getAsset(db, assetId);
  if (!asset) return { error: "Varlık bulunamadı" };
  upsertLicense(db, assetId, parsed.data);
  revalidatePath(`/projects/${asset.project_id}`);
  return {};
}

export async function assetJobAction(formData: FormData) {
  const assetId = String(formData.get("assetId"));
  const type = String(formData.get("jobType"));
  if (type !== "asset_analyze" && type !== "audio_normalize") throw new Error("Geçersiz iş");
  const db = getDb();
  const asset = getAsset(db, assetId);
  if (!asset) throw new Error("Varlık bulunamadı");
  enqueueJob(db, { type, projectId: asset.project_id, payload: { assetId } });
  revalidatePath(`/projects/${asset.project_id}`);
}

export async function deleteAssetAction(formData: FormData) {
  const assetId = String(formData.get("assetId"));
  const db = getDb();
  const asset = getAsset(db, assetId);
  if (!asset) return;
  deleteAsset(db, getConfig().dataDir, assetId);
  revalidatePath(`/projects/${asset.project_id}`);
}

export async function enqueueRenderAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = renderOptionsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues.map((i) => i.message).join(", ") };
  const db = getDb();
  const o = parsed.data;
  const audio = getAsset(db, o.audioAssetId);
  const visual = getAsset(db, o.visualAssetId);
  if (!audio || audio.project_id !== o.projectId || audio.type !== "audio")
    return { error: "Ses dosyası bu projeye ait değil" };
  if (
    !visual ||
    visual.project_id !== o.projectId ||
    visual.type === "audio" ||
    visual.type === "other"
  )
    return { error: "Görsel bu projeye ait değil" };
  const busy = db
    .prepare(
      "SELECT COUNT(*) AS n FROM jobs WHERE project_id = ? AND type = 'render_video' AND status IN ('queued','running')",
    )
    .get(o.projectId) as { n: number };
  if (Number(busy.n) > 0) return { error: "Bu proje için zaten bekleyen/çalışan bir render var" };
  enqueueJob(db, { type: "render_video", projectId: o.projectId, payload: o, maxAttempts: 3 });
  revalidatePath(`/projects/${o.projectId}`);
  return {};
}

export type PublishFormState = FormState & { ok?: string };

export async function saveMetadataAction(
  _prev: PublishFormState,
  formData: FormData,
): Promise<PublishFormState> {
  const parsed = metadataSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues.map((i) => i.message).join(", ") };
  const m = parsed.data;
  saveMetadata(getDb(), m.projectId, {
    language: m.language,
    title: m.ytTitle,
    description: m.description,
    tags: parseTags(m.tags),
    playlist: m.playlist || undefined,
    aiGenerated: m.aiGenerated,
  });
  revalidatePath(`/projects/${m.projectId}`);
  return { ok: "Kaydedildi" };
}

/** Sablondan yeniden doldurur (mevcut metnin uzerine yazar). */
export async function suggestMetadataAction(formData: FormData) {
  const projectId = String(formData.get("projectId"));
  const lang = formData.get("language") === "tr" ? "tr" : "en";
  const scene = String(formData.get("scene") ?? "").slice(0, 60);
  const aiGenerated = formData.get("aiGenerated") === "on";
  const db = getDb();
  const project = getProject(db, projectId);
  if (!project) return;
  ensureMetadata(db, project, lang);
  const d = suggestMetadata({
    category: project.category,
    durationSec: project.duration_sec,
    scene,
    lang,
    aiGenerated,
  });
  saveMetadata(db, projectId, {
    language: lang,
    title: d.title,
    description: d.description,
    tags: d.tags,
    aiGenerated,
  });
  revalidatePath(`/projects/${projectId}`);
}

export async function generateThumbnailAction(formData: FormData) {
  const assetId = String(formData.get("assetId"));
  const text = String(formData.get("text") ?? "").slice(0, 120);
  const db = getDb();
  const asset = getAsset(db, assetId);
  if (!asset) throw new Error("Kaynak bulunamadı");
  enqueueJob(db, {
    type: "thumbnail_generate",
    projectId: asset.project_id,
    payload: { assetId, text },
  });
  revalidatePath(`/projects/${asset.project_id}`);
}

export async function selectThumbnailAction(formData: FormData) {
  const projectId = String(formData.get("projectId"));
  setThumbnail(getDb(), projectId, String(formData.get("assetId")));
  revalidatePath(`/projects/${projectId}`);
}

export async function exportPackageAction(
  _prev: PublishFormState,
  formData: FormData,
): Promise<PublishFormState> {
  const projectId = String(formData.get("projectId"));
  try {
    const r = exportPackage(getDb(), getConfig().outputDir, projectId);
    revalidatePath(`/projects/${projectId}`);
    return { ok: `Paket hazır: ${r.dir}` };
  } catch (err) {
    if (err instanceof PublishError) return { error: err.message };
    throw err;
  }
}

export async function recordUploadAction(
  _prev: PublishFormState,
  formData: FormData,
): Promise<PublishFormState> {
  const projectId = String(formData.get("projectId"));
  const privacy = String(formData.get("privacy"));
  if (privacy !== "private" && privacy !== "unlisted" && privacy !== "public")
    return { error: "Gizlilik seç" };
  try {
    recordUpload(getDb(), projectId, {
      video: String(formData.get("video") ?? ""),
      privacy,
      scheduledAt: String(formData.get("scheduledAt") ?? "") || null,
      notes: String(formData.get("notes") ?? ""),
    });
  } catch (err) {
    if (err instanceof PublishError || err instanceof ApprovalBlockedError)
      return { error: err.message };
    throw err;
  }
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/");
  return { ok: "Kaydedildi" };
}

export async function generateAudioAction(
  _prev: PublishFormState,
  formData: FormData,
): Promise<PublishFormState> {
  const fields = Object.fromEntries(formData) as Record<string, string>;
  const presetValue = String(fields.preset ?? "");
  const musicStyle = presetValue.startsWith("music:") ? presetValue.slice(6) : null;
  if (musicStyle && !(musicStyle in MUSIC_STYLES)) return { error: "Geçersiz müzik türü" };
  const parsed = synthSchema.safeParse({ ...fields, preset: musicStyle ? "pad" : presetValue });
  if (!parsed.success) return { error: parsed.error.issues.map((i) => i.message).join(", ") };
  const o = parsed.data;
  const db = getDb();
  if (musicStyle) {
    if (!getProject(db, o.projectId)) return { error: "Proje bulunamadı" };
    for (let i = 0; i < o.count; i++) {
      enqueueJob(db, {
        type: "music_compose",
        projectId: o.projectId,
        payload: {
          projectId: o.projectId,
          style: musicStyle,
          minutes: o.minutes,
          seed: Math.floor(Math.random() * 900_000) + 100_000,
        },
      });
    }
    revalidatePath(`/projects/${o.projectId}`);
    return { ok: `${o.count} müzik üretim işi kuyruğa alındı` };
  }
  if (!getProject(db, o.projectId)) return { error: "Proje bulunamadı" };
  for (let i = 0; i < o.count; i++) {
    const seed = Math.floor(Math.random() * 900_000) + 100_000;
    enqueueJob(db, {
      type: "audio_generate",
      projectId: o.projectId,
      payload: { projectId: o.projectId, preset: o.preset, minutes: o.minutes, seed },
    });
  }
  revalidatePath(`/projects/${o.projectId}`);
  return { ok: `${o.count} üretim işi kuyruğa alındı` };
}

export async function mixAudioAction(
  _prev: PublishFormState,
  formData: FormData,
): Promise<PublishFormState> {
  let raw: unknown;
  try {
    raw = JSON.parse(String(formData.get("payload") ?? "{}"));
  } catch {
    return { error: "Geçersiz istek" };
  }
  const parsed = mixSchema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues.map((i) => i.message).join(", ") };
  const o = parsed.data;
  const db = getDb();
  for (const id of [...o.trackIds, ...(o.bedId ? [o.bedId] : [])]) {
    const a = getAsset(db, id);
    if (!a || a.project_id !== o.projectId || a.type !== "audio")
      return { error: "Seçilen parçalardan biri bu projede yok" };
    if (!getLicense(db, a.parent_asset_id ?? a.id)?.reviewed_at)
      return { error: `Önce lisansı onayla: ${a.original_name}` };
  }
  enqueueJob(db, { type: "audio_mix", projectId: o.projectId, payload: o });
  revalidatePath(`/projects/${o.projectId}`);
  return { ok: "Karışım işi kuyruğa alındı" };
}

function activeAutoJob(projectId: string) {
  return getDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM jobs WHERE project_id = ? AND type IN ('auto_produce','auto_finalize','render_video')
         AND status IN ('queued','running')`,
    )
    .get(projectId) as { n: number };
}

export async function autoProduceAction(formData: FormData) {
  const projectId = String(formData.get("projectId"));
  const db = getDb();
  if (!getProject(db, projectId) || Number(activeAutoJob(projectId).n) > 0) return;
  const variants = Math.min(3, Math.max(1, Number(formData.get("variants") ?? 1) || 1));
  const batch = randomUUID();
  for (let i = 0; i < variants; i++)
    enqueueJob(db, {
      type: "auto_produce",
      projectId,
      payload: { projectId, batch, variant: i },
      maxAttempts: 1,
    });
  revalidatePath(`/projects/${projectId}`);
}

export async function autoFinalizeAction(formData: FormData) {
  const projectId = String(formData.get("projectId"));
  const autoJobId = String(formData.get("autoJobId"));
  const dark = Number(formData.get("darkAfterMin") ?? 0);
  const darkAfterMin = [0, 10, 15, 20, 30, 45, 60].includes(dark) ? dark : 0;
  const db = getDb();
  if (!getProject(db, projectId) || Number(activeAutoJob(projectId).n) > 0) return;
  enqueueJob(db, {
    type: "auto_finalize",
    projectId,
    payload: { projectId, autoJobId, darkAfterMin },
    maxAttempts: 2,
  });
  revalidatePath(`/projects/${projectId}`);
}

export async function generateVisualAction(
  _prev: PublishFormState,
  formData: FormData,
): Promise<PublishFormState> {
  const parsed = visualSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues.map((i) => i.message).join(", ") };
  const db = getDb();
  if (!getProject(db, parsed.data.projectId)) return { error: "Proje bulunamadı" };
  enqueueJob(db, {
    type: "visual_generate",
    projectId: parsed.data.projectId,
    payload: { ...parsed.data, seed: Math.floor(Math.random() * 900_000) + 100_000 },
  });
  revalidatePath(`/projects/${parsed.data.projectId}`);
  return { ok: "Görsel üretim işi kuyruğa alındı" };
}

export async function aiVisualAction(
  _prev: PublishFormState,
  formData: FormData,
): Promise<PublishFormState> {
  const projectId = String(formData.get("projectId"));
  const scene = String(formData.get("scene") || "");
  if (scene && !(scene in SCENES)) return { error: "Geçersiz sahne" };
  const db = getDb();
  if (!getProject(db, projectId)) return { error: "Proje bulunamadı" };
  const cfg = getConfig();
  if (!isImageAiReady(cfg.aiDir, cfg.imagePython))
    return { error: "Görsel yapay zekâsı kurulu değil (GORSEL-KUR.bat)" };
  enqueueJob(db, {
    type: "ai_visual",
    projectId,
    payload: {
      projectId,
      scene: scene || undefined,
      seed: Math.floor(Math.random() * 900_000) + 100_000,
    },
  });
  revalidatePath(`/projects/${projectId}`);
  return { ok: "Yapay zekâ görseli kuyruğa alındı (birkaç dakika sürer)" };
}

export async function aiMusicAction(
  _prev: PublishFormState,
  formData: FormData,
): Promise<PublishFormState> {
  const projectId = String(formData.get("projectId"));
  const style = String(formData.get("style"));
  const minutes = Number(formData.get("minutes"));
  if (!(style in AI_STYLES)) return { error: "Geçersiz stil" };
  if (![2, 5, 10, 20, 30].includes(minutes)) return { error: "Geçersiz süre" };
  const db = getDb();
  if (!getProject(db, projectId)) return { error: "Proje bulunamadı" };
  const cfg = getConfig();
  if (!isAiReady(cfg.aiDir, cfg.aiPython)) return { error: "Yapay zekâ kurulu değil (AI-KUR.bat)" };
  enqueueJob(db, {
    type: "ai_music",
    projectId,
    payload: { projectId, style, minutes, seed: Math.floor(Math.random() * 900_000) + 100_000 },
    maxAttempts: 2,
  });
  revalidatePath(`/projects/${projectId}`);
  return { ok: "Yapay zekâ müzik işi kuyruğa alındı" };
}

export async function addStatAction(
  _prev: PublishFormState,
  formData: FormData,
): Promise<PublishFormState> {
  const parsed = statSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Görüntülenme sayısını sayı olarak gir" };
  const db = getDb();
  if (!getProject(db, parsed.data.projectId)) return { error: "Proje bulunamadı" };
  addStat(db, parsed.data);
  revalidatePath(`/projects/${parsed.data.projectId}`);
  revalidatePath("/istatistik");
  return { ok: "Kaydedildi" };
}

export async function backupAction(): Promise<PublishFormState> {
  const cfg = getConfig();
  try {
    const r = backupDb(getDb(), cfg.dataDir);
    revalidatePath("/bakim");
    return { ok: `Yedek alındı: ${r.file}` };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export async function cleanupAction(): Promise<PublishFormState> {
  const cfg = getConfig();
  const r = cleanup(getDb(), cfg.dataDir);
  revalidatePath("/bakim");
  return { ok: `Temizlendi: ${r.removed} klasör, ${(r.bytes / 1024 ** 3).toFixed(2)} GB boşaldı` };
}

export async function planCreateAction(formData: FormData) {
  const category = String(formData.get("category"));
  const date = String(formData.get("date"));
  const parsed = createProjectSchema.safeParse({
    title: `${(CATEGORIES as Record<string, string>)[category] ?? category} · ${date}`,
    category,
    durationHours: formData.get("hours"),
    targetDate: date,
  });
  if (!parsed.success) return;
  const db = getDb();
  const project = createProject(db, parsed.data);
  const batch = randomUUID();
  for (let i = 0; i < 3; i++)
    enqueueJob(db, {
      type: "auto_produce",
      projectId: project.id,
      payload: { projectId: project.id, batch, variant: i },
      maxAttempts: 1,
    });
  redirect(`/projects/${project.id}`);
}
