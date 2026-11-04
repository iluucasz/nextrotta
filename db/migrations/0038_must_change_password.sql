-- A password set by the platform owner (reset or new admin) is temporary: the person must choose their
-- own at the next sign-in. Cleared when they do.
ALTER TABLE users ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT FALSE;
