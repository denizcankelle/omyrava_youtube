import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { type Asset, formatBytes, formatClock, getAsset, getLicense, listAssets } from "./assets";
import { type DB, audit, nowIso } from "./db";
import {
  type Lang,
  type MetaIssue,
  parseYoutubeId,
  suggestMetadata,
  validateMetadata,
} from "./metadata";
import { type Project, getProject, projectOutputDir, setProjectStatus } from "./projects";

export interface ProjectMetadata {
  project_id: string;
  language: Lang;
  yt_title: string;
  description: string;
  tags: string;
  playlist: string | null;
  ai_generated: number;
  thumbnail_asset_id: string | null;
  render_id: string | null;
  package_dir: string | null;
  packaged_at: string | null;
  updated_at: string;
}

export interface RenderRow {
  id: string;
  project_id: string;
  profile: string;
  output_path: string;
  status: string;
  duration_sec: number | null;
  size_bytes: number | null;
  qa_status: string;
  created_at: string;
}

export interface Publication {
  id: string;
  project_id: string;
  youtube_video_id: string | null;
  url: string | null;
  privacy: "private" | "unlisted" | "public";
  scheduled_at: string | null;
  published_at: string | null;
  status: string;
  notes: string | null;
  created_at: string;
}

export class PublishError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublishError";
  }
}

export function getMetadata(db: DB, projectId: string): ProjectMetadata | undefined {
  return db.prepare("SELECT * FROM project_metadata WHERE project_id = ?").get(projectId) as
    ProjectMetadata | undefined;
}

/** Kayit yoksa sablondan baslangic metniyle olusturur. */
export function ensureMetadata(db: DB, project: Project, lang: Lang = "en"): ProjectMetadata {
  const existing = getMetadata(db, project.id);
  if (existing) return existing;
  const d = suggestMetadata({
    category: project.category,
    durationSec: project.duration_sec,
    scene: "",
    lang,
    aiGenerated: false,
  });
  db.prepare(
    `INSERT INTO project_metadata (project_id, language, yt_title, description, tags, ai_generated)
     VALUES (?, ?, ?, ?, ?, 0)`,
  ).run(project.id, lang, d.title, d.description, JSON.stringify(d.tags));
  return getMetadata(db, project.id)!;
}

export function saveMetadata(
  db: DB,
  projectId: string,
  m: {
    language: Lang;
    title: string;
    description: string;
    tags: string[];
    playlist?: string;
    aiGenerated: boolean;
  },
) {
  const project = getProject(db, projectId);
  if (!project) throw new PublishError("Proje bulunamadı");
  ensureMetadata(db, project, m.language);
  db.prepare(
    `UPDATE project_metadata SET language = ?, yt_title = ?, description = ?, tags = ?, playlist = ?,
       ai_generated = ?, updated_at = ? WHERE project_id = ?`,
  ).run(
    m.language,
    m.title.trim(),
    m.description.replace(/\r\n/g, "\n").trim(),
    JSON.stringify(m.tags),
    m.playlist || null,
    m.aiGenerated ? 1 : 0,
    nowIso(),
    projectId,
  );
  audit(db, "metadata.save", "project", projectId, { title: m.title });
}

export function metadataIssues(db: DB, projectId: string): MetaIssue[] {
  const m = getMetadata(db, projectId);
  if (!m) return [{ level: "error", field: "title", message: "Başlık ve açıklama girilmemiş" }];
  const issues = validateMetadata({
    title: m.yt_title,
    description: m.description,
    tags: JSON.parse(m.tags) as string[],
    aiGenerated: Boolean(m.ai_generated),
    lang: m.language,
  });
  // Ayni baslik baska projede var mi? (tekrar eden icerik riski)
  const dup = db
    .prepare(
      "SELECT COUNT(*) AS n FROM project_metadata WHERE yt_title = ? AND project_id != ? AND yt_title != ''",
    )
    .get(m.yt_title, projectId) as { n: number };
  if (Number(dup.n) > 0)
    issues.push({
      level: "warn",
      field: "title",
      message: "Bu başlık başka bir projede de var; tekrar eden içerik gibi görünebilir",
    });
  return issues;
}

export function setThumbnail(db: DB, projectId: string, assetId: string) {
  const a = getAsset(db, assetId);
  if (!a || a.project_id !== projectId || a.type !== "thumbnail")
    throw new PublishError("Kapak bu projeye ait değil");
  const project = getProject(db, projectId)!;
  ensureMetadata(db, project);
  db.prepare(
    "UPDATE project_metadata SET thumbnail_asset_id = ?, updated_at = ? WHERE project_id = ?",
  ).run(assetId, nowIso(), projectId);
}

export function latestFullRender(db: DB, projectId: string): RenderRow | undefined {
  return db
    .prepare(
      `SELECT * FROM renders WHERE project_id = ? AND profile LIKE 'full_%' AND status = 'done'
         AND qa_status = 'passed' ORDER BY created_at DESC LIMIT 1`,
    )
    .get(projectId) as RenderRow | undefined;
}

/** Secili kapak; secilmemisse projedeki en son kapak. */
export function currentThumbnail(db: DB, projectId: string): Asset | undefined {
  const m = getMetadata(db, projectId);
  if (m?.thumbnail_asset_id) {
    const a = getAsset(db, m.thumbnail_asset_id);
    if (a) return a;
  }
  return listAssets(db, projectId)
    .filter((a) => a.type === "thumbnail")
    .at(-1);
}

export function buildDescriptionFile(input: {
  project: Project;
  meta: ProjectMetadata;
  render: RenderRow;
  thumbnailName: string | null;
}): string {
  const tags = JSON.parse(input.meta.tags) as string[];
  const line = "=".repeat(60);
  return [
    `OMYRAVA STUDIO — YAYIN PAKETİ`,
    `Proje: ${input.project.title}`,
    `Hazırlanma: ${nowIso().slice(0, 16).replace("T", " ")}`,
    line,
    "BAŞLIK",
    input.meta.yt_title,
    "",
    "AÇIKLAMA",
    input.meta.description,
    "",
    "ETİKETLER (virgülle, YouTube Studio > Etiketler alanına yapıştır)",
    tags.join(", "),
    "",
    input.meta.playlist ? `OYNATMA LİSTESİ: ${input.meta.playlist}\n` : "",
    line,
    "DOSYALAR",
    `Video : ${path.basename(input.render.output_path)} (${formatClock(input.render.duration_sec)}, ${formatBytes(input.render.size_bytes)})`,
    `Kapak : ${input.thumbnailName ?? "-"}`,
    "",
    "YÜKLEME KONTROL LİSTESİ",
    "[ ] Videoyu önce 'Özel' (Private) veya 'Liste dışı' olarak yükle",
    "[ ] Başlık, açıklama, etiketler ve kapağı bu dosyadan aktar",
    "[ ] 'Çocuklar için yapılmadı' seçeneğini işaretle",
    input.meta.ai_generated
      ? "[ ] 'Değiştirilmiş veya sentetik içerik' sorusunu EVET olarak işaretle (yapay zekâ kullanıldı)"
      : "[ ] 'Değiştirilmiş veya sentetik içerik' sorusunu gerçeğe uygun yanıtla",
    "[ ] Telif kontrolü (Checks) bitene kadar yayınlama",
    "[ ] Yayın tarihini planla, sonra panelde 'YouTube'a yükledim' formuna video bağlantısını gir",
    "",
  ]
    .filter((l, i, arr) => !(l === "" && arr[i - 1] === ""))
    .join("\n");
}

export function buildLicenseFile(db: DB, projectId: string): string {
  const assets = listAssets(db, projectId);
  const rows = assets.map((a) => {
    const lic = getLicense(db, a.parent_asset_id ?? a.id);
    return [
      `- ${a.original_name} [${a.type}]`,
      `  SHA-256 : ${a.checksum ?? "-"}`,
      `  Kaynak  : ${a.source}`,
      a.parent_asset_id ? `  Türetildiği varlık: ${a.parent_asset_id}` : null,
      `  Lisans  : ${lic ? `${lic.provider}${lic.license_type ? ` / ${lic.license_type}` : ""}` : "KAYITLI DEĞİL"}`,
      lic?.terms_version ? `  Şartlar : ${lic.terms_version}` : null,
      lic?.evidence_path ? `  Kanıt   : ${lic.evidence_path}` : null,
      `  Kontrol : ${lic?.reviewed_at ? lic.reviewed_at.slice(0, 10) : "YAPILMADI"}`,
    ]
      .filter(Boolean)
      .join("\n");
  });
  return [`LİSANS VE KAYNAK KAYDI — ${nowIso().slice(0, 10)}`, "", ...rows, ""].join("\n");
}

/** Cikti klasorune yukleme paketini yazar: baslik-aciklama.txt, lisanslar.txt, kapak.jpg. */
export function exportPackage(db: DB, outputDir: string, projectId: string) {
  const project = getProject(db, projectId);
  if (!project) throw new PublishError("Proje bulunamadı");
  const render = latestFullRender(db, projectId);
  if (!render || !fs.existsSync(render.output_path))
    throw new PublishError("Kalite kontrolünden geçmiş tam render yok");
  const meta = ensureMetadata(db, project);
  const errors = metadataIssues(db, projectId).filter((i) => i.level === "error");
  if (errors.length)
    throw new PublishError(`Metaveri hataları: ${errors.map((e) => e.message).join("; ")}`);
  const thumb = currentThumbnail(db, projectId);

  const dir = projectOutputDir(outputDir, project);
  fs.mkdirSync(dir, { recursive: true });
  let thumbName: string | null = null;
  if (thumb && fs.existsSync(thumb.file_path)) {
    thumbName = `kapak${path.extname(thumb.file_path).toLowerCase() || ".jpg"}`;
    fs.copyFileSync(thumb.file_path, path.join(/*turbopackIgnore: true*/ dir, thumbName));
  }
  fs.writeFileSync(
    path.join(dir, "baslik-aciklama.txt"),
    "﻿" + buildDescriptionFile({ project, meta, render, thumbnailName: thumbName }),
  );
  fs.writeFileSync(path.join(dir, "lisanslar.txt"), "﻿" + buildLicenseFile(db, projectId));
  db.prepare(
    "UPDATE project_metadata SET package_dir = ?, packaged_at = ?, render_id = ?, thumbnail_asset_id = COALESCE(thumbnail_asset_id, ?) WHERE project_id = ?",
  ).run(dir, nowIso(), render.id, thumb?.id ?? null, projectId);
  audit(db, "package.export", "project", projectId, { dir });
  return { dir, video: render.output_path, thumbnail: thumbName };
}

export function getPublication(db: DB, projectId: string): Publication | undefined {
  return db.prepare("SELECT * FROM publications WHERE project_id = ?").get(projectId) as
    Publication | undefined;
}

/**
 * Kullanici videoyu YouTube'a elle yukledikten sonra kayit: video kimligi, gizlilik, plan.
 * Proje: approved -> uploaded -> (scheduled | published).
 */
export function recordUpload(
  db: DB,
  projectId: string,
  input: {
    video: string;
    privacy: "private" | "unlisted" | "public";
    scheduledAt?: string | null;
    notes?: string;
  },
): Publication {
  const project = getProject(db, projectId);
  if (!project) throw new PublishError("Proje bulunamadı");
  if (!["approved", "uploaded", "scheduled", "published"].includes(project.status))
    throw new PublishError("Önce projeyi onayla (durum: Onaylandı)");
  const videoId = parseYoutubeId(input.video);
  if (!videoId) throw new PublishError("Geçerli bir YouTube bağlantısı veya video kimliği gir");
  let scheduled: string | null = null;
  if (input.scheduledAt) {
    const d = new Date(input.scheduledAt);
    if (Number.isNaN(d.getTime())) throw new PublishError("Geçersiz yayın tarihi");
    scheduled = d.toISOString();
  }
  const url = `https://youtu.be/${videoId}`;
  const status =
    scheduled && new Date(scheduled) > new Date()
      ? "scheduled"
      : input.privacy === "public"
        ? "published"
        : "uploaded";
  const existing = getPublication(db, projectId);
  if (existing) {
    db.prepare(
      `UPDATE publications SET youtube_video_id = ?, url = ?, privacy = ?, scheduled_at = ?, status = ?,
         notes = ?, published_at = CASE WHEN ? = 'published' THEN COALESCE(published_at, ?) ELSE published_at END
       WHERE project_id = ?`,
    ).run(
      videoId,
      url,
      input.privacy,
      scheduled,
      status,
      input.notes || null,
      status,
      nowIso(),
      projectId,
    );
  } else {
    db.prepare(
      `INSERT INTO publications (id, project_id, youtube_video_id, url, privacy, scheduled_at, status, notes, published_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      randomUUID(),
      projectId,
      videoId,
      url,
      input.privacy,
      scheduled,
      status,
      input.notes || null,
      status === "published" ? nowIso() : null,
    );
  }
  audit(db, "publication.record", "project", projectId, { videoId, status });

  // Proje durumunu ilerlet: approved -> uploaded -> scheduled/published
  if (project.status === "approved") setProjectStatus(db, projectId, "uploaded");
  const cur = getProject(db, projectId)!.status;
  if (status === "scheduled" && cur === "uploaded") setProjectStatus(db, projectId, "scheduled");
  if (status === "published" && (cur === "uploaded" || cur === "scheduled"))
    setProjectStatus(db, projectId, "published");
  return getPublication(db, projectId)!;
}
