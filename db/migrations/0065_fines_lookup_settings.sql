-- The company's own switch for the weekly automatic fines lookup: the owner grants the feature (fines_lookup), and the company can pause
-- and resume the Sunday lookup from the Carros screen. A company with no row here has it on.

CREATE TABLE fines_lookup_settings (
  organization_id  UUID PRIMARY KEY REFERENCES organizations (id),
  auto_enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by       UUID
);
