CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  nickname TEXT,
  avatar_url TEXT,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS layouts (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  layout_json JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS libraries (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  library_json JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS library_items (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  position INT NOT NULL,
  widget_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS email_verifications (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  purpose TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_nickname_unique
ON users (LOWER(nickname))
WHERE nickname IS NOT NULL AND BTRIM(nickname) <> '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique
ON users (LOWER(email))
WHERE email IS NOT NULL AND BTRIM(email) <> '';

CREATE INDEX IF NOT EXISTS idx_library_items_user_position ON library_items(user_id, position);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'library_items_position_non_negative'
  ) THEN
    ALTER TABLE library_items
      ADD CONSTRAINT library_items_position_non_negative CHECK (position >= 0);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_library_items_user_position_unique
ON library_items(user_id, position);

CREATE INDEX IF NOT EXISTS idx_email_verifications_email_purpose
ON email_verifications (email, purpose, id DESC);
