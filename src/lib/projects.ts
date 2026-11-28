import { randomUUID } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { validateMetadata } from "./metadata";
import { type DB, audit, nowIso } from "./db";
import { assertTransition, canTransition, type ProjectStatus } from "./status";

export const CATEGORIES = {
  deep_sleep: "Deep Sleep",
  rain: "Rain",
  meditation: "Meditation",
  cosmic: "Cosmic",
  piano: "Piano",
  piano_violin: "Romantic Piano",
  nordic: "Nordic / Viking",
  strings: "Strings & Cello",
  ocean: "Ocean Waves",
  lofi: "Lo-fi (drumless)",
  dark_blues: "Dark Blues",
} as const;

/** Kullanimdan kalkan turler: eski projeler acilir ama yenisi olusturulamaz. */
// rain: kullanici yagmur sesini hic istemiyor (28.11)
export const RETIRED_CATEGORIES: readonly string[] = ["strings", "rain"];

export const DURATION_PRESETS_HOURS = [1, 3, 8, 10] as const;

export const createProjectSchema = z.object({
  title: z.string().trim().min(3, "Başlık en az 3 karakter olmalı").max(100),
  category: z
    .enum(Object.keys(CATEGORIES) as [keyof typeof CATEGORIES])
    .refine((c) => !RETIRED_CATEGORIES.includes(c), "Bu tür kullanımdan kaldırıldı"),
  durationHours: z.coerce.number().refine((v) => [1, 3, 8, 10].includes(v), "Geçersiz süre"),
  resolution: z.enum(["1080p", "2k", "4k"]).default("2k"),
  targetDate: z.string().trim().optional().or(z.literal("")),
  notes: z.string().trim().max(2000).optional(),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export interface Project {
  id: string;
  title: string;
  category: keyof typeof CATEGORIES;
  duration_sec: number;
  resolution: "1080p" | "2k" | "4k";
  status: ProjectStatus;
  target_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export function createProject(db: DB, input: CreateProjectInput): Project {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO projects (id, title, category, duration_sec, resolution, target_date, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.title,
    input.category,
    Math.round(input.durationHours * 3600),
    input.resolution,
    input.targetDate || null,
    input.notes || null,
  );
  audit(db, "project.create", "project", id, { title: input.title });
  return getProject(db, id)!;
}

export function getProject(db: DB, id: string): Project | undefined {
  return db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as Project | undefined;
}

export function listProjects(db: DB): Project[] {
  return db
    .prepare("SELECT * FROM projects ORDER BY created_at DESC")
    .all() as unknown as Project[];
}

export function setProjectStatus(db: DB, id: string, to: ProjectStatus): Project {
  const project = getProject(db, id);
  if (!project) throw new Error("Proje bulunamadı");
  assertTransition(project.status, to);
  if (to === "approved") assertApprovable(db, id);
  if (to === "uploaded") {
    const pub = db
      .prepare("SELECT youtube_video_id FROM publications WHERE project_id = ?")
      .get(id) as { youtube_video_id: string | null } | undefined;
    if (!pub?.youtube_video_id && project.status === "approved")
      throw new ApprovalBlockedError(["önce 'YouTube'a yükledim' formuna video bağlantısını gir"]);
  }
  db.prepare("UPDATE projects SET status = ?, updated_at = ? WHERE id = ?").run(to, nowIso(), id);
  audit(db, "project.status", "project", id, { from: project.status, to });
  if (to === "cancelled") {
    // Iptal edilen projenin bekleyen/calisan isleri de iptal edilir
    db.prepare(
      "UPDATE jobs SET status = 'cancelled', locked_at = NULL, updated_at = ? WHERE project_id = ? AND status IN ('queued','running')",
    ).run(nowIso(), id);
  }
  return getProject(db, id)!;
}

/** Gecis kurallara uyuyorsa uygular; uymuyorsa sessizce birakir. */
export function tryProjectStatus(db: DB, id: string, to: ProjectStatus): boolean {
  const project = getProject(db, id);
  if (!project || !canTransition(project.status, to)) return false;
  db.prepare("UPDATE projects SET status = ?, updated_at = ? WHERE id = ?").run(to, nowIso(), id);
  audit(db, "project.status", "project", id, { from: project.status, to, auto: true });
  return true;
}

export class ApprovalBlockedError extends Error {
  constructor(public reasons: string[]) {
    super(`Onaylanamaz: ${reasons.join("; ")}`);
    this.name = "ApprovalBlockedError";
  }
}

/** Yayin onayi icin: en az bir ses varligi olmali ve tum varliklarin lisansi incelenmis olmali. */
export function approvalBlockers(db: DB, projectId: string): string[] {
  const reasons: string[] = [];
  const audio = db
    .prepare("SELECT COUNT(*) AS n FROM assets WHERE project_id = ? AND type = 'audio'")
    .get(projectId) as { n: number };
  if (Number(audio.n) === 0) reasons.push("projede ses dosyası yok");
  const missing = db
    .prepare(
      `SELECT a.original_name AS name FROM assets a
       LEFT JOIN licenses l ON l.asset_id = COALESCE(a.parent_asset_id, a.id)
       WHERE a.project_id = ? AND (l.id IS NULL OR l.reviewed_at IS NULL)`,
    )
    .all(projectId) as { name: string | null }[];
  if (missing.length)
    reasons.push(`lisansı onaylanmamış varlık: ${missing.map((m) => m.name ?? "?").join(", ")}`);
  const render = db
    .prepare(
      `SELECT COUNT(*) AS n FROM renders WHERE project_id = ? AND profile LIKE 'full_%'
         AND status = 'done' AND qa_status = 'passed'`,
    )
    .get(projectId) as { n: number };
  if (Number(render.n) === 0) reasons.push("kalite kontrolünden geçmiş tam render yok");
  const meta = db
    .prepare(
      "SELECT yt_title, description, tags, ai_generated, language FROM project_metadata WHERE project_id = ?",
    )
    .get(projectId) as
    | {
        yt_title: string;
        description: string;
        tags: string;
        ai_generated: number;
        language: "en" | "tr";
      }
    | undefined;
  if (!meta || !meta.yt_title.trim()) reasons.push("YouTube başlığı/açıklaması girilmemiş");
  else {
    const errs = validateMetadata({
      title: meta.yt_title,
      description: meta.description,
      tags: JSON.parse(meta.tags) as string[],
      aiGenerated: Boolean(meta.ai_generated),
      lang: meta.language,
    }).filter((i) => i.level === "error");
    if (errs.length) reasons.push(`metaveri hatası: ${errs.map((e) => e.message).join(", ")}`);
  }
  const thumb = db
    .prepare("SELECT COUNT(*) AS n FROM assets WHERE project_id = ? AND type = 'thumbnail'")
    .get(projectId) as { n: number };
  if (Number(thumb.n) === 0) reasons.push("kapak görseli yok");
  return reasons;
}

function assertApprovable(db: DB, projectId: string) {
  const reasons = approvalBlockers(db, projectId);
  if (reasons.length) throw new ApprovalBlockedError(reasons);
}

/** Projenin cikti klasoru: output/<guvenli-ad>-<id8> */
export function projectOutputDir(
  outputDir: string,
  project: { id: string; title: string },
): string {
  return path.join(outputDir, `${safeFileName(project.title)}-${project.id.slice(0, 8)}`);
}

export function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return m ? `${h} sa ${m} dk` : `${h} saat`;
}

/** Dosya/klasor adi icin guvenli kisa ad (Windows uyumlu). */
export function safeFileName(input: string): string {
  const map: Record<string, string> = { ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u" };
  const base = input
    .toLowerCase()
    .replace(/[çğıöşü]/g, (c) => map[c] ?? c)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return base || "proje";
}
