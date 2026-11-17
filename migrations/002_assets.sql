-- Gorev 002: varlik ayrintilari ve analiz sonuclari

ALTER TABLE assets ADD COLUMN original_name TEXT;
ALTER TABLE assets ADD COLUMN size_bytes INTEGER;
ALTER TABLE assets ADD COLUMN duration_sec REAL;
ALTER TABLE assets ADD COLUMN width INTEGER;
ALTER TABLE assets ADD COLUMN height INTEGER;
ALTER TABLE assets ADD COLUMN analysis TEXT;
ALTER TABLE assets ADD COLUMN analyzed_at TEXT;
ALTER TABLE assets ADD COLUMN parent_asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL;

ALTER TABLE licenses ADD COLUMN license_type TEXT;
CREATE UNIQUE INDEX idx_licenses_asset ON licenses(asset_id);
