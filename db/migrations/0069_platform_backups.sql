-- Backup of the whole platform (every table of the database, all companies together), made every night by the worker and
-- on demand by the owner. The file lives in the private storage under platform-backups/, encrypted, so losing the database
-- does not lose the copies. The register is here; copies past the retention are removed from the storage and the row
-- becomes 'expired' (rows are never deleted). Companies' own daily backups are a different thing (organization_backups).
CREATE TABLE platform_backups (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          VARCHAR(16) NOT NULL DEFAULT 'daily' CHECK (kind IN ('daily', 'manual')),
  status        VARCHAR(16) NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed', 'expired')),
  backup_date   DATE NOT NULL,
  storage_url   TEXT,
  size_bytes    BIGINT NOT NULL DEFAULT 0,
  table_counts  JSONB NOT NULL DEFAULT '{}'::jsonb,
  error         TEXT,
  created_by    UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at  TIMESTAMPTZ,
  expired_at    TIMESTAMPTZ
);

-- one nightly copy per day (a failed attempt does not block the next one)
CREATE UNIQUE INDEX platform_backups_daily_key
  ON platform_backups (backup_date)
  WHERE kind = 'daily' AND status IN ('running', 'completed');

CREATE INDEX platform_backups_created_idx ON platform_backups (created_at DESC);
