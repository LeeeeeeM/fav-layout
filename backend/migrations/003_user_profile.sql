ALTER TABLE users
  ADD COLUMN IF NOT EXISTS nickname TEXT;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS avatar_url TEXT;

UPDATE users
SET nickname = username
WHERE nickname IS NULL OR BTRIM(nickname) = '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_nickname_unique
ON users (LOWER(nickname))
WHERE nickname IS NOT NULL AND BTRIM(nickname) <> '';
