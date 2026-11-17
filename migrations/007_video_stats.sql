-- Kanal panosu: kullanicinin YouTube Studio'dan elle girdigi video istatistikleri.
CREATE TABLE video_stats (
  id                 TEXT PRIMARY KEY,
  project_id         TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  recorded_at        TEXT NOT NULL,
  views              INTEGER NOT NULL CHECK (views >= 0),
  watch_hours        REAL CHECK (watch_hours >= 0),
  avg_view_sec       INTEGER CHECK (avg_view_sec >= 0),
  ctr                REAL CHECK (ctr >= 0 AND ctr <= 100),
  subscribers_gained INTEGER,
  notes              TEXT,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_video_stats_project ON video_stats(project_id, recorded_at);
