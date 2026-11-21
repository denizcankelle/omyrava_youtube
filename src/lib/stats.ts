/**
 * Kanal panosu: YouTube Studio'dan elle girilen istatistikler (API yok). Hangi kategori ve
 * sahnenin daha cok izlendigini ozetler, sonraki video icin oneri verir.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { DB } from "./db";
import { CATEGORIES, RETIRED_CATEGORIES } from "./projects";
import { SCENES } from "./scene";
import { VISUAL_PRESETS } from "./visual";

const num = (min = 0) =>
  z.preprocess(
    (v) =>
      v === "" || v === null || v === undefined ? undefined : Number(String(v).replace(",", ".")),
    z.number().min(min).optional(),
  );

export const statSchema = z.object({
  projectId: z.string().min(1),
  recordedAt: z.string().optional(),
  views: z.preprocess((v) => Number(String(v).replace(/[.\s]/g, "")), z.number().int().min(0)),
  watchHours: num(),
  /** Ortalama izlenme suresi, dakika (or. 12.5) */
  avgViewMin: num(),
  ctr: z.preprocess(
    (v) =>
      v === "" || v === undefined
        ? undefined
        : Number(String(v).replace(",", ".").replace("%", "")),
    z.number().min(0).max(100).optional(),
  ),
  subscribers: z.preprocess(
    (v) => (v === "" || v === undefined ? undefined : Number(v)),
    z.number().int().optional(),
  ),
  notes: z.string().max(500).optional(),
});
export type StatInput = z.infer<typeof statSchema>;

export interface VideoStat {
  id: string;
  project_id: string;
  recorded_at: string;
  views: number;
  watch_hours: number | null;
  avg_view_sec: number | null;
  ctr: number | null;
  subscribers_gained: number | null;
  notes: string | null;
}

export function addStat(db: DB, input: StatInput): VideoStat {
  const id = randomUUID();
  const at = input.recordedAt ? new Date(input.recordedAt) : new Date();
  db.prepare(
    `INSERT INTO video_stats (id, project_id, recorded_at, views, watch_hours, avg_view_sec, ctr,
       subscribers_gained, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.projectId,
    (Number.isNaN(at.getTime()) ? new Date() : at).toISOString(),
    input.views,
    input.watchHours ?? null,
    input.avgViewMin !== undefined ? Math.round(input.avgViewMin * 60) : null,
    input.ctr ?? null,
    input.subscribers ?? null,
    input.notes?.trim() || null,
  );
  return db.prepare("SELECT * FROM video_stats WHERE id = ?").get(id) as unknown as VideoStat;
}

export function listStats(db: DB, projectId: string): VideoStat[] {
  return db
    .prepare("SELECT * FROM video_stats WHERE project_id = ? ORDER BY recorded_at DESC")
    .all(projectId) as unknown as VideoStat[];
}

/** Projenin gorsel sahnesi (yapay zeka sahnesi ya da yerlesik gorsel turu). */
export function projectScene(db: DB, projectId: string): string | null {
  const row = db
    .prepare(
      `SELECT source FROM assets WHERE project_id = ? AND type = 'video_loop'
         AND (source LIKE 'aivisual:%' OR source LIKE 'visual:%')
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get(projectId) as { source: string } | undefined;
  if (!row) return null;
  const [kind, id] = row.source.split(":");
  if (kind === "aivisual") return (SCENES as Record<string, { label: string }>)[id]?.label ?? id;
  return (VISUAL_PRESETS as Record<string, { label: string }>)[id]?.label ?? id;
}

export interface Row {
  key: string;
  label: string;
  videos: number;
  views: number;
  watchHours: number;
  avgViewMin: number | null;
  ctr: number | null;
}

export interface Summary {
  totals: { videos: number; views: number; watchHours: number };
  byCategory: Row[];
  byScene: Row[];
  advice: string[];
}

/** Her projenin en son istatistigi uzerinden kategori ve sahne ozetleri. */
export function summarize(db: DB): Summary {
  const latest = db
    .prepare(
      `SELECT s.*, p.category, p.title FROM video_stats s JOIN projects p ON p.id = s.project_id
       WHERE s.recorded_at = (SELECT MAX(recorded_at) FROM video_stats x WHERE x.project_id = s.project_id)`,
    )
    .all() as unknown as (VideoStat & { category: string; title: string })[];
  const group = (keyOf: (s: (typeof latest)[number]) => string, labelOf: (k: string) => string) => {
    const m = new Map<string, (typeof latest)[number][]>();
    for (const s of latest) {
      const k = keyOf(s);
      m.set(k, [...(m.get(k) ?? []), s]);
    }
    const avg = (xs: (number | null)[]) => {
      const v = xs.filter((x): x is number => x !== null);
      return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
    };
    return [...m.entries()]
      .map(([k, xs]) => ({
        key: k,
        label: labelOf(k),
        videos: xs.length,
        views: xs.reduce((a, s) => a + s.views, 0),
        watchHours: xs.reduce((a, s) => a + (s.watch_hours ?? 0), 0),
        avgViewMin: (() => {
          const a = avg(xs.map((s) => s.avg_view_sec));
          return a === null ? null : a / 60;
        })(),
        ctr: avg(xs.map((s) => s.ctr)),
      }))
      .sort(
        (a, b) =>
          b.watchHours / b.videos - a.watchHours / a.videos ||
          b.views / b.videos - a.views / a.videos,
      );
  };
  const byCategory = group(
    (s) => s.category,
    (k) => (CATEGORIES as Record<string, string>)[k] ?? k,
  );
  const byScene = group(
    (s) => projectScene(db, s.project_id) ?? "—",
    (k) => k,
  );
  const advice: string[] = [];
  if (latest.length < 3)
    advice.push(
      "Anlamlı öneri için en az 3 videonun istatistiğini gir (yükledikten 7 ve 28 gün sonra).",
    );
  else {
    const best = byCategory[0];
    advice.push(
      `En çok izlenme süresi getiren tür: ${best.label} (video başına ${(best.watchHours / best.videos).toFixed(0)} saat). Sıradaki videoların çoğu bu türde olsun.`,
    );
    if (byScene.length > 1 && byScene[0].key !== "—")
      advice.push(`En iyi sahne: ${byScene[0].label}. Kapak ve başlıkta bu havayı öne çıkar.`);
    const lowCtr = byCategory.filter((r) => r.ctr !== null && r.ctr < 3);
    if (lowCtr.length)
      advice.push(
        `Tıklama oranı düşük (%3 altı): ${lowCtr.map((r) => r.label).join(", ")}. Pakettaki kapak-2/kapak-3 ile “Test & compare” dene.`,
      );
    const untried = Object.entries(CATEGORIES)
      .filter(([k]) => !RETIRED_CATEGORIES.includes(k) && !byCategory.some((r) => r.key === k))
      .map(([, l]) => l);
    if (untried.length)
      advice.push(
        `Henüz denenmemiş türler: ${untried.slice(0, 4).join(", ")}. Ayda bir deneme yap.`,
      );
  }
  return {
    totals: {
      videos: latest.length,
      views: latest.reduce((a, s) => a + s.views, 0),
      watchHours: latest.reduce((a, s) => a + (s.watch_hours ?? 0), 0),
    },
    byCategory,
    byScene,
    advice,
  };
}
