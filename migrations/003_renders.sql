-- Gorev 003: uzun video render kayitlari

ALTER TABLE renders ADD COLUMN job_id TEXT;
ALTER TABLE renders ADD COLUMN status TEXT NOT NULL DEFAULT 'done';
ALTER TABLE renders ADD COLUMN options TEXT;
ALTER TABLE renders ADD COLUMN warnings TEXT;
ALTER TABLE renders ADD COLUMN finished_at TEXT;
CREATE INDEX idx_renders_project ON renders(project_id);
