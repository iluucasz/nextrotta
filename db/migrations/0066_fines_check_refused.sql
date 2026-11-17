-- A new result for a car's fines lookup: the agency REFUSED the plate or the Renavam ("Renavam incorreto"). It is not asked again (every
-- question is billed) until someone edits the car's data, which clears the mark. Widening the list is safe for the code that is live now.

ALTER TABLE vehicles DROP CONSTRAINT IF EXISTS vehicles_fines_check_status_check;
ALTER TABLE vehicles ADD CONSTRAINT vehicles_fines_check_status_check
  CHECK (fines_check_status IS NULL OR fines_check_status IN ('ok', 'partial', 'error', 'missing_data', 'refused'));
