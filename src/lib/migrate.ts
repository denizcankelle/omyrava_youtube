import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

/** migrations/ klasorundeki .sql dosyalarini sirayla ve bir kez uygular. */
export function runMigrations(db: DatabaseSync, dir: string): string[] {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`);
  const done = new Set(
    (db.prepare("SELECT name FROM schema_migrations").all() as { name: string }[]).map(
      (r) => r.name,
    ),
  );
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const applied: string[] = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), "utf8");
    // Tablo yeniden kurulumu gereken migration'lar: yabanci anahtar denetimi gecici olarak kapali
    // (PRAGMA islem icinde degistirilemez, bu yuzden BEGIN'den once).
    const fkOff = sql.startsWith("-- @foreign_keys_off");
    if (fkOff) db.exec("PRAGMA foreign_keys = OFF");
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run(file);
      if (fkOff) {
        const bad = db.prepare("PRAGMA foreign_key_check").all();
        if (bad.length) throw new Error(`yabancı anahtar hatası: ${JSON.stringify(bad[0])}`);
      }
      db.exec("COMMIT");
      if (fkOff) db.exec("PRAGMA foreign_keys = ON");
      applied.push(file);
    } catch (err) {
      db.exec("ROLLBACK");
      if (fkOff) db.exec("PRAGMA foreign_keys = ON");
      throw new Error(`Migration basarisiz: ${file}: ${(err as Error).message}`);
    }
  }
  return applied;
}
