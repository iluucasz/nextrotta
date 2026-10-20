-- VPS management on the owner panel: usage history collected by the worker from the VPS agent,
-- cleanups (manual and automatic), infrastructure costs entered by the owner.

-- One sample of the whole host every 5 minutes.
CREATE TABLE vps_metrics (
  id                 BIGSERIAL PRIMARY KEY,
  collected_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cpu_percent        NUMERIC(5, 1),
  load_1             NUMERIC(6, 2),
  memory_used_bytes  BIGINT,
  memory_total_bytes BIGINT,
  memory_available_bytes BIGINT,
  disk_used_bytes    BIGINT,
  disk_total_bytes   BIGINT,
  disk_percent       NUMERIC(5, 1),
  -- Cumulative counters of the host's interfaces; the panel shows the difference between samples.
  network_rx_bytes   BIGINT,
  network_tx_bytes   BIGINT
);

CREATE INDEX vps_metrics_collected_idx ON vps_metrics (collected_at DESC);

-- The same sample per container.
CREATE TABLE vps_container_metrics (
  id                 BIGSERIAL PRIMARY KEY,
  collected_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  container_name     TEXT NOT NULL,
  owner              TEXT NOT NULL CHECK (owner IN ('nextrotta', 'production', 'shared', 'unknown')),
  state              TEXT NOT NULL,
  cpu_percent        NUMERIC(6, 1),
  memory_bytes       BIGINT,
  memory_limit_bytes BIGINT,
  restart_count      INTEGER,
  log_bytes          BIGINT
);

CREATE INDEX vps_container_metrics_idx ON vps_container_metrics (container_name, collected_at DESC);

-- Every cleanup run: what it removed (or would remove, for a preview) and the space freed.
CREATE TABLE vps_cleanups (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger       TEXT NOT NULL CHECK (trigger IN ('manual', 'auto')),
  dry_run       BOOLEAN NOT NULL,
  actor_id      UUID REFERENCES users (id),
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  freed_bytes   BIGINT NOT NULL DEFAULT 0,
  disk_before   NUMERIC(5, 1),
  disk_after    NUMERIC(5, 1),
  actions       JSONB NOT NULL DEFAULT '[]'::jsonb,
  error         TEXT
);

CREATE INDEX vps_cleanups_started_idx ON vps_cleanups (started_at DESC);

-- Infrastructure costs, entered by the owner month by month (VPS, Vercel, Neon, domain, WhatsApp…).
-- A wrong entry is archived (deleted_at), never removed.
CREATE TABLE infra_costs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  month        TEXT NOT NULL CHECK (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  category     TEXT NOT NULL CHECK (category IN ('vps', 'vercel', 'database', 'domain', 'whatsapp', 'ai', 'email', 'other')),
  description  TEXT NOT NULL DEFAULT '',
  amount       NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by   UUID REFERENCES users (id),
  deleted_at   TIMESTAMPTZ,
  deleted_by   UUID REFERENCES users (id)
);

CREATE INDEX infra_costs_month_idx ON infra_costs (month) WHERE deleted_at IS NULL;
