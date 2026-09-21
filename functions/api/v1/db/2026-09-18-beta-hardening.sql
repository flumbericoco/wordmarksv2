-- Beta hardening: keep large generated assets in R2 and persist reviewer feedback.
-- Run once against the production D1 database.
ALTER TABLE generation_jobs ADD COLUMN r2_key TEXT;

CREATE TABLE IF NOT EXISTS quality_learnings (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  generation_id TEXT,
  brand_key TEXT NOT NULL,
  brand_name TEXT NOT NULL,
  overall REAL NOT NULL,
  scores TEXT NOT NULL DEFAULT '{}',
  feedback TEXT NOT NULL DEFAULT '',
  suggestions TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (generation_id) REFERENCES generation_jobs(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_quality_learnings_lookup
  ON quality_learnings(user_id, brand_key, created_at);
