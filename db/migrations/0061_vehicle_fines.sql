-- App "Carros", Multas: every traffic fine of a company's cars, who was driving, and where each one stands
-- (driver told, driver aware, driver indicated at the traffic authority, appeal, paid).
-- Soft delete like every domain table (deleted_at / deleted_by).

CREATE TABLE vehicle_fines (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      UUID NOT NULL REFERENCES organizations (id),
  vehicle_id           UUID NOT NULL REFERENCES vehicles (id),
  -- The driver at the time of the infraction (suggested from the car's history, confirmed by the admin).
  technician_id        UUID REFERENCES technicians (id),
  -- Número do auto de infração (AIT), as printed on the notification.
  ait_number           TEXT,
  infraction_at        TIMESTAMPTZ NOT NULL,
  description          TEXT NOT NULL,
  location             TEXT,
  -- Órgão autuador (Detran, PRF, prefeitura...).
  authority            TEXT,
  amount               NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  points               SMALLINT CHECK (points IS NULL OR points BETWEEN 0 AND 20),
  -- When the company got the notification, the deadline to name the driver, and when the fine itself is due.
  received_on          DATE,
  indication_deadline  DATE,
  payment_due          DATE,
  -- The driver was told (WhatsApp and "Minhas multas"), and what he answered.
  notified_at          TIMESTAMPTZ,
  acknowledged_at      TIMESTAMPTZ,
  -- Who recorded the "ciente": the technician himself or the admin on his behalf.
  acknowledged_by      VARCHAR(16) CHECK (acknowledged_by IS NULL OR acknowledged_by IN ('technician', 'admin')),
  driver_stance        VARCHAR(16) CHECK (driver_stance IS NULL OR driver_stance IN ('agrees', 'disputes')),
  driver_note          TEXT,
  -- Driver named at the traffic authority (done outside, in the Carteira Digital de Trânsito or the Detran site).
  indicated_at         TIMESTAMPTZ,
  appeal_status        VARCHAR(16) NOT NULL DEFAULT 'none' CHECK (appeal_status IN ('none', 'planned', 'filed', 'won', 'lost')),
  paid_at              DATE,
  notes                TEXT,
  created_by           UUID,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at           TIMESTAMPTZ,
  deleted_by           UUID
);

CREATE INDEX vehicle_fines_org_idx ON vehicle_fines (organization_id, infraction_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX vehicle_fines_vehicle_idx ON vehicle_fines (vehicle_id) WHERE deleted_at IS NULL;
CREATE INDEX vehicle_fines_technician_idx ON vehicle_fines (organization_id, technician_id) WHERE deleted_at IS NULL;
-- The same notification is not registered twice for a company.
CREATE UNIQUE INDEX vehicle_fines_org_ait_idx ON vehicle_fines (organization_id, ait_number) WHERE deleted_at IS NULL AND ait_number IS NOT NULL;
