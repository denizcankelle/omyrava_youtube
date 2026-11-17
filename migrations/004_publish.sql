-- Gorev 004: yayin paketi ve metaveri

CREATE TABLE project_metadata (
  project_id    TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  language      TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en','tr')),
  yt_title      TEXT NOT NULL DEFAULT '',
  description   TEXT NOT NULL DEFAULT '',
  tags          TEXT NOT NULL DEFAULT '[]',
  playlist      TEXT,
  ai_generated  INTEGER NOT NULL DEFAULT 1,
  thumbnail_asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
  render_id     TEXT REFERENCES renders(id) ON DELETE SET NULL,
  package_dir   TEXT,
  packaged_at   TEXT,
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

ALTER TABLE publications ADD COLUMN url TEXT;
ALTER TABLE publications ADD COLUMN published_at TEXT;
ALTER TABLE publications ADD COLUMN notes TEXT;
CREATE UNIQUE INDEX idx_publications_project ON publications(project_id);
