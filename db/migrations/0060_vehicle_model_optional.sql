-- The model is no longer typed when a car is added: it (like brand, year, Renavam...) comes back from the plate lookup,
-- so a car can exist with only its plate.
ALTER TABLE vehicles ALTER COLUMN model DROP NOT NULL;
