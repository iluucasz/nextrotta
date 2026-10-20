-- One Evolution instance per organization, named after its subdomain and created from the
-- organization's own WhatsApp screen. The Evolution server (URL + global key) stays in the
-- environment and is shared by every organization; only the instance is per organization.
ALTER TABLE whatsapp_config
  ADD COLUMN instance_name        TEXT,
  ADD COLUMN instance_created_at  TIMESTAMPTZ,
  -- Last connection seen (cache for screens and the owner panel; Evolution is the source of truth).
  ADD COLUMN connected_number     TEXT,
  ADD COLUMN connected_name       TEXT,
  ADD COLUMN connection_state     TEXT,
  ADD COLUMN connection_checked_at TIMESTAMPTZ;

CREATE UNIQUE INDEX whatsapp_config_instance_name_idx ON whatsapp_config (instance_name) WHERE instance_name IS NOT NULL;
