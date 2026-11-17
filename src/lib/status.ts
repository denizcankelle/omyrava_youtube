/** Proje yasam dongusu. YouTube'a yukleme elle yapildigi icin 'uploaded' kullanici tarafindan isaretlenir. */
export const PROJECT_STATUSES = [
  "draft",
  "queued",
  "generating",
  "reviewing",
  "rendering",
  "qa_failed",
  "ready",
  "approved",
  "uploaded",
  "scheduled",
  "published",
  "failed",
  "cancelled",
] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

const TRANSITIONS: Record<ProjectStatus, readonly ProjectStatus[]> = {
  draft: ["queued", "cancelled"],
  queued: ["generating", "rendering", "failed", "cancelled"],
  generating: ["reviewing", "failed", "cancelled"],
  reviewing: ["rendering", "draft", "cancelled"],
  rendering: ["ready", "qa_failed", "failed", "cancelled"],
  qa_failed: ["queued", "draft", "cancelled"],
  ready: ["approved", "draft", "cancelled"],
  approved: ["uploaded", "ready", "cancelled"],
  uploaded: ["scheduled", "published"],
  scheduled: ["published", "uploaded"],
  published: [],
  failed: ["queued", "draft", "cancelled"],
  cancelled: ["draft"],
};

export const STATUS_LABELS: Record<ProjectStatus, string> = {
  draft: "Taslak",
  queued: "Kuyrukta",
  generating: "Üretiliyor",
  reviewing: "İncelemede",
  rendering: "Render",
  qa_failed: "QA başarısız",
  ready: "Hazır",
  approved: "Onaylandı",
  uploaded: "Yüklendi",
  scheduled: "Planlandı",
  published: "Yayında",
  failed: "Hata",
  cancelled: "İptal",
};

export function isProjectStatus(value: string): value is ProjectStatus {
  return (PROJECT_STATUSES as readonly string[]).includes(value);
}

export function canTransition(from: ProjectStatus, to: ProjectStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function allowedNext(from: ProjectStatus): readonly ProjectStatus[] {
  return TRANSITIONS[from];
}

export class InvalidTransitionError extends Error {
  constructor(from: string, to: string) {
    super(`Gecersiz durum gecisi: ${from} -> ${to}`);
    this.name = "InvalidTransitionError";
  }
}

export function assertTransition(from: string, to: string): void {
  if (!isProjectStatus(from) || !isProjectStatus(to) || !canTransition(from, to)) {
    throw new InvalidTransitionError(from, to);
  }
}
