import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getConfig } from "./config";
import { runMigrations } from "./migrate";

export type DB = DatabaseSync;

/** Yeni baglanti acar, ayarlari yapar ve migration'lari uygular. */
export function openDatabase(dbPath: string, migrationsDir: string): DB {
  if (dbPath !== ":memory:") fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  plainRows(db);
  // WAL: panel ve worker ayni anda okuyup yazabilsin.
  if (dbPath !== ":memory:") db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA foreign_keys = ON");
  runMigrations(db, migrationsDir);
  return db;
}

/**
 * node:sqlite satirlari prototipsiz nesnelerdir; Next.js bunlari istemci bilesenlerine
 * aktaramaz. Tum get/all sonuclarini duz nesneye cevirir.
 */
function plainRows(db: DatabaseSync) {
  const prepare = db.prepare.bind(db);
  db.prepare = ((sql: string) => {
    const st = prepare(sql);
    const get = st.get.bind(st);
    const all = st.all.bind(st);
    Object.defineProperty(st, "get", {
      value: (...args: Parameters<typeof get>) => {
        const row = get(...args);
        return row ? { ...row } : row;
      },
    });
    Object.defineProperty(st, "all", {
      value: (...args: Parameters<typeof all>) => all(...args).map((r) => ({ ...r })),
    });
    return st;
  }) as typeof db.prepare;
}

const globalForDb = globalThis as unknown as { __omyravaDb?: DB };

/** Uygulama genelinde tek baglanti (Next.js dev yeniden yuklemelerinde de). */
export function getDb(): DB {
  if (!globalForDb.__omyravaDb) {
    const cfg = getConfig();
    globalForDb.__omyravaDb = openDatabase(cfg.dbPath, cfg.migrationsDir);
  } else if (process.env.NODE_ENV !== "production") {
    // Gelistirme modunda kod guncellenince yeni migration'lar yeniden baslatmadan uygulansin.
    runMigrations(globalForDb.__omyravaDb, getConfig().migrationsDir);
  }
  return globalForDb.__omyravaDb;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function audit(
  db: DB,
  action: string,
  targetType: string,
  targetId: string | null,
  details?: unknown,
) {
  db.prepare(
    "INSERT INTO audit_events (action, target_type, target_id, details) VALUES (?, ?, ?, ?)",
  ).run(action, targetType, targetId, details === undefined ? null : JSON.stringify(details));
}
