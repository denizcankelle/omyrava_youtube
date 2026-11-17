-- Omyrava Studio ilk sema (SQLite)

CREATE TABLE projects (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  category      TEXT NOT NULL CHECK (category IN ('deep_sleep','rain','meditation','cosmic','piano')),
  duration_sec  INTEGER NOT NULL CHECK (duration_sec > 0),
  resolution    TEXT NOT NULL DEFAULT '1080p' CHECK (resolution IN ('1080p','4k')),
  status        TEXT NOT NULL DEFAULT 'draft',
  target_date   TEXT,
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE assets (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN ('audio','image','video_loop','thumbnail','other')),
  file_path   TEXT NOT NULL,
  checksum    TEXT,
  source      TEXT NOT NULL DEFAULT 'upload',
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_assets_project ON assets(project_id);

CREATE TABLE licenses (
  id             TEXT PRIMARY KEY,
  asset_id       TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  provider       TEXT NOT NULL,
  terms_version  TEXT,
  evidence_path  TEXT,
  notes          TEXT,
  reviewed_at    TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE jobs (
  id             TEXT PRIMARY KEY,
  project_id     TEXT REFERENCES projects(id) ON DELETE SET NULL,
  type           TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'queued'
                 CHECK (status IN ('queued','running','succeeded','failed','cancelled')),
  payload        TEXT NOT NULL DEFAULT '{}',
  result         TEXT,
  step           TEXT,
  progress       REAL NOT NULL DEFAULT 0,
  attempts       INTEGER NOT NULL DEFAULT 0,
  max_attempts   INTEGER NOT NULL DEFAULT 3,
  run_after      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  locked_at      TEXT,
  error_code     TEXT,
  error_message  TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_jobs_pick ON jobs(status, run_after);
CREATE INDEX idx_jobs_project ON jobs(project_id);

CREATE TABLE job_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id      TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  level       TEXT NOT NULL CHECK (level IN ('info','warn','error')),
  message     TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_job_logs_job ON job_logs(job_id);

CREATE TABLE renders (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  profile       TEXT NOT NULL,
  output_path   TEXT NOT NULL,
  duration_sec  REAL,
  size_bytes    INTEGER,
  qa_status     TEXT NOT NULL DEFAULT 'pending' CHECK (qa_status IN ('pending','passed','failed')),
  qa_notes      TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- YouTube'a yukleme elle yapilir; burada sadece kaydi tutulur.
CREATE TABLE publications (
  id                TEXT PRIMARY KEY,
  project_id        TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  youtube_video_id  TEXT,
  privacy           TEXT NOT NULL DEFAULT 'private' CHECK (privacy IN ('private','unlisted','public')),
  scheduled_at      TEXT,
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','uploaded','scheduled','published')),
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE audit_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  action       TEXT NOT NULL,
  target_type  TEXT NOT NULL,
  target_id    TEXT,
  details      TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
