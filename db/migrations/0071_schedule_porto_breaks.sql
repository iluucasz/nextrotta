-- Escala: the partial indisponibilidades Porto lists on a day (lunch, "parada autorizada", personal matters...),
-- kept as Porto returns them: [{ "start": "12:30", "end": "13:30", "reason": "ALMOCO" }].
-- Information for the escala screens only: status, times and notes keep driving payroll and hours.
ALTER TABLE schedule ADD COLUMN porto_breaks JSONB;
