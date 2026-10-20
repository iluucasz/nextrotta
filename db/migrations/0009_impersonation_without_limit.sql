-- "Entrar na conta" has no time limit: the session lasts until the owner leaves it (or their login
-- expires). NULL = no limit; older rows keep their expiry.
ALTER TABLE impersonation_sessions ALTER COLUMN expires_at DROP NOT NULL;
