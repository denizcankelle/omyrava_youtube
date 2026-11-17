import { getConfig } from "../src/lib/config";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { runMigrations } from "../src/lib/migrate";

const cfg = getConfig();
fs.mkdirSync(path.dirname(cfg.dbPath), { recursive: true });
const db = new DatabaseSync(cfg.dbPath);
const applied = runMigrations(db, cfg.migrationsDir);
console.log(applied.length ? `Uygulandi: ${applied.join(", ")}` : "Veritabani guncel.");
db.close();
