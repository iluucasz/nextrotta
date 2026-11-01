-- The last time the Porto login was tried from the Config. Porto screen and how it went, so the screen can say
-- "conectado" or "o Porto recusou o login" without trying again every time it opens. Reset whenever the CPF or
-- the password change: a login that was never tried with the new data is not a working login.
ALTER TABLE porto_config
  ADD COLUMN last_login_test_at      TIMESTAMPTZ,
  ADD COLUMN last_login_test_ok      BOOLEAN,
  ADD COLUMN last_login_test_message TEXT;
