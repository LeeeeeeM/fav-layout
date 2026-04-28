CREATE TABLE IF NOT EXISTS library_items (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  position INT NOT NULL,
  widget_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_library_items_user_position ON library_items(user_id, position);

INSERT INTO library_items (user_id, position, widget_json, created_at, updated_at)
SELECT
  l.user_id,
  (ele.ord - 1)::INT,
  ele.item,
  NOW(),
  NOW()
FROM libraries l
CROSS JOIN LATERAL jsonb_array_elements(l.library_json) WITH ORDINALITY AS ele(item, ord)
WHERE jsonb_typeof(l.library_json) = 'array'
  AND NOT EXISTS (
    SELECT 1
    FROM library_items li
    WHERE li.user_id = l.user_id
  );
