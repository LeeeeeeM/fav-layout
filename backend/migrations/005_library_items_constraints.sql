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
