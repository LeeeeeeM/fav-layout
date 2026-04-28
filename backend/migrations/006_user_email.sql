ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique
ON users (LOWER(email))
WHERE email IS NOT NULL AND BTRIM(email) <> '';
