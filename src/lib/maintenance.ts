/**
 * Bakim: veritabani yedegi (VACUUM INTO) ve eski ara dosyalarin temizligi.
 * Worker gunde bir kez kendiliginden calistirir; panelde elle de calistirilabilir.
 */
import fs from "node:fs";
import path from "node:path";
import type { DB } from "./db";

export const KEEP_BACKUPS = 14;
const HOUR = 3600 * 1000;

function stamp(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function backupDir(dataDir: string) {
  return path.join(dataDir, "yedek");
}

export function listBackups(dataDir: string): { file: string; size: number; mtimeMs: number }[] {
  const dir = backupDir(dataDir);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /^omyrava-\d{8}-\d{6}\.db$/.test(f))
    .map((f) => {
      const st = fs.statSync(path.join(dir, f));
      return { file: path.join(dir, f), size: st.size, mtimeMs: st.mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

/** Tutarli anlik yedek; en yeni KEEP_BACKUPS yedek tutulur. */
export function backupDb(
  db: DB,
  dataDir: string,
  now = new Date(),
): { file: string; size: number } {
  const dir = backupDir(dataDir);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `omyrava-${stamp(now)}.db`);
  if (fs.existsSync(file)) fs.rmSync(file);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  for (const old of listBackups(dataDir).slice(KEEP_BACKUPS)) fs.rmSync(old.file, { force: true });
  return { file, size: fs.statSync(file).size };
}

/** Son yedek 24 saatten eskiyse yedek alir. */
export function autoBackup(db: DB, dataDir: string): string | null {
  const last = listBackups(dataDir)[0];
  if (last && Date.now() - last.mtimeMs < 24 * HOUR) return null;
  return backupDb(db, dataDir).file;
}

export function dirSize(p: string): number {
  if (!fs.existsSync(p)) return 0;
  const st = fs.statSync(p);
  if (!st.isDirectory()) return st.size;
  let total = 0;
  for (const e of fs.readdirSync(p)) total += dirSize(path.join(p, e));
  return total;
}

/**
 * Silinebilir ara dosyalar: data/work altindaki eski is klasorleri, bitmis/basarisiz
 * renderlarin calisma klasorleri ve gecici kapak/shorts klasorleri. Calisan islere dokunmaz.
 */
export function cleanup(
  db: DB,
  dataDir: string,
  opts: { olderThanHours?: number; now?: number } = {},
): { removed: number; bytes: number; paths: string[] } {
  const now = opts.now ?? Date.now();
  const minAge = (opts.olderThanHours ?? 6) * HOUR;
  const activeIds = (
    db.prepare("SELECT id FROM jobs WHERE status IN ('queued','running')").all() as { id: string }[]
  ).map((r) => r.id);
  const inUse = (name: string) => activeIds.some((id) => name.includes(id.slice(0, 8)));
  const old = (p: string) => now - fs.statSync(p).mtimeMs > minAge;
  const victims: string[] = [];

  const work = path.join(dataDir, "work");
  if (fs.existsSync(work))
    for (const e of fs.readdirSync(work)) {
      const p = path.join(work, e);
      if (!inUse(e) && old(p)) victims.push(p);
    }
  const renders = path.join(dataDir, "renders");
  if (fs.existsSync(renders))
    for (const proj of fs.readdirSync(renders)) {
      const pd = path.join(renders, proj);
      if (!fs.statSync(pd).isDirectory()) continue;
      for (const jobDir of fs.readdirSync(pd)) {
        const p = path.join(pd, jobDir);
        if (!activeIds.includes(jobDir) && old(p)) victims.push(p);
      }
    }
  for (const e of fs.readdirSync(dataDir)) {
    if (!/^(thumb|short)-/.test(e)) continue;
    const p = path.join(dataDir, e);
    if (now - fs.statSync(p).mtimeMs > HOUR) victims.push(p);
  }
  let bytes = 0;
  for (const v of victims) {
    bytes += dirSize(v);
    fs.rmSync(v, { recursive: true, force: true });
  }
  return { removed: victims.length, bytes, paths: victims };
}

export function freeBytes(dir: string): number | null {
  try {
    const s = fs.statfsSync(dir);
    return Number(s.bavail) * Number(s.bsize);
  } catch {
    return null;
  }
}

/**
 * YouTube'a yuklenmis projelerin buyuk dosyalarini siler: tam video, onizleme, Shorts ve
 * ses/goruntu varliklari. Kapaklar, metinler ve lisans dosyalari kalir. Gerekirse proje
 * yeniden uretilebilir.
 */
export function purgeUploaded(
  db: DB,
  opts: { olderThanDays?: number; now?: number; dryRun?: boolean } = {},
): { projects: { id: string; title: string; bytes: number }[]; bytes: number } {
  const now = opts.now ?? Date.now();
  const minAge = (opts.olderThanDays ?? 0) * 24 * HOUR;
  const rows = db
    .prepare(
      `SELECT p.id, p.title, pub.created_at AS uploaded_at, m.package_dir FROM projects p
       JOIN publications pub ON pub.project_id = p.id
       LEFT JOIN project_metadata m ON m.project_id = p.id
       WHERE p.status IN ('uploaded','scheduled','published') AND pub.youtube_video_id IS NOT NULL`,
    )
    .all() as { id: string; title: string; uploaded_at: string; package_dir: string | null }[];
  const result: { id: string; title: string; bytes: number }[] = [];
  let total = 0;
  for (const r of rows) {
    if (now - Date.parse(r.uploaded_at) < minAge) continue;
    const files: string[] = [];
    for (const rd of db
      .prepare("SELECT output_path FROM renders WHERE project_id = ?")
      .all(r.id) as { output_path: string }[])
      if (rd.output_path && fs.existsSync(rd.output_path)) files.push(rd.output_path);
    if (r.package_dir && fs.existsSync(path.join(r.package_dir, "short.mp4")))
      files.push(path.join(r.package_dir, "short.mp4"));
    const media = db
      .prepare(
        "SELECT id, file_path FROM assets WHERE project_id = ? AND type IN ('audio','video_loop')",
      )
      .all(r.id) as { id: string; file_path: string }[];
    for (const a of media) if (fs.existsSync(a.file_path)) files.push(a.file_path);
    let bytes = 0;
    for (const f of files) bytes += fs.statSync(f).size;
    if (!bytes) continue;
    if (!opts.dryRun) {
      for (const f of files) fs.rmSync(f, { force: true });
      const del = db.prepare("DELETE FROM assets WHERE id = ?");
      for (const a of media) del.run(a.id);
    }
    result.push({ id: r.id, title: r.title, bytes });
    total += bytes;
  }
  return { projects: result, bytes: total };
}
