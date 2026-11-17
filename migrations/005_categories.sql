-- @foreign_keys_off
-- Gorev 007: yeni kategoriler (nordic, piano_violin, strings). SQLite CHECK kisitini
-- degistirmek icin tablo yeniden kurulur.

CREATE TABLE projects_new (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  category      TEXT NOT NULL CHECK (category IN
                  ('deep_sleep','rain','meditation','cosmic','piano','piano_violin','nordic','strings')),
  duration_sec  INTEGER NOT NULL CHECK (duration_sec > 0),
  resolution    TEXT NOT NULL DEFAULT '1080p' CHECK (resolution IN ('1080p','4k')),
  status        TEXT NOT NULL DEFAULT 'draft',
  target_date   TEXT,
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
INSERT INTO projects_new (id, title, category, duration_sec, resolution, status, target_date, notes, created_at, updated_at)
  SELECT id, title, category, duration_sec, resolution, status, target_date, notes, created_at, updated_at FROM projects;
DROP TABLE projects;
ALTER TABLE projects_new RENAME TO projects;
