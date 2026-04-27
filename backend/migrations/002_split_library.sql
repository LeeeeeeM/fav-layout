CREATE TABLE IF NOT EXISTS libraries (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  library_json JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO libraries (user_id, library_json, updated_at)
SELECT l.user_id, l.layout_json->'library', l.updated_at
FROM layouts l
WHERE l.layout_json ? 'library'
  AND NOT EXISTS (
    SELECT 1
    FROM libraries b
    WHERE b.user_id = l.user_id
  );

UPDATE layouts
SET layout_json = layout_json - 'library'
WHERE layout_json ? 'library';
