-- What each lookup found, car by car and agency by agency (the History tab opens it in a window): which agencies answered, what
-- they brought and which fines were new. Lines recorded before this migration have none, and the window shows only their summary.

ALTER TABLE fines_lookup_runs ADD COLUMN IF NOT EXISTS details JSONB;
