-- Persist the most recent fetch failure reason per source, so the admin
-- monitoring view can surface *why* a source is failing (not just failCount).
-- Cleared on the next successful fetch (markSourceSuccess sets both to NULL).
ALTER TABLE sources ADD COLUMN IF NOT EXISTS last_error text;
ALTER TABLE sources ADD COLUMN IF NOT EXISTS last_error_at timestamptz;
