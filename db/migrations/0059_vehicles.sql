-- App "Carros": the company's vehicles, the technician each one is with, and the history of who had it.
-- Soft delete like every domain table (deleted_at / deleted_by): a removed car keeps its history.

CREATE TABLE vehicles (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations (id),
  -- Normalized: upper case, letters and digits only (ABC1D23 or ABC1234).
  plate            VARCHAR(7) NOT NULL,
  brand            TEXT,
  model            TEXT NOT NULL,
  year             INTEGER CHECK (year IS NULL OR year BETWEEN 1950 AND 2100),
  color            TEXT,
  renavam          VARCHAR(11),
  chassis          VARCHAR(17),
  fuel             TEXT,
  odometer         INTEGER CHECK (odometer IS NULL OR odometer >= 0),
  licensing_due    DATE,
  insurance_due    DATE,
  notes            TEXT,
  status           VARCHAR(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'maintenance', 'inactive')),
  -- Who has the car now; the history is in vehicle_assignments.
  technician_id    UUID REFERENCES technicians (id),
  created_by       UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at       TIMESTAMPTZ,
  deleted_by       UUID
);

-- One live car per plate in a company; a removed one frees the plate.
CREATE UNIQUE INDEX vehicles_org_plate_idx ON vehicles (organization_id, plate) WHERE deleted_at IS NULL;
CREATE INDEX vehicles_technician_idx ON vehicles (organization_id, technician_id) WHERE deleted_at IS NULL;

-- Append-only log: a row opens when the car goes to a technician and closes (released_at) when it leaves.
CREATE TABLE vehicle_assignments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations (id),
  vehicle_id       UUID NOT NULL REFERENCES vehicles (id),
  technician_id    UUID NOT NULL REFERENCES technicians (id),
  assigned_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  released_at      TIMESTAMPTZ,
  assigned_by      UUID,
  released_by      UUID
);

CREATE INDEX vehicle_assignments_vehicle_idx ON vehicle_assignments (vehicle_id, assigned_at DESC);
CREATE INDEX vehicle_assignments_org_idx ON vehicle_assignments (organization_id, technician_id);
