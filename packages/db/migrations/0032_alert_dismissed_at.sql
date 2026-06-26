ALTER TABLE item_analysis ADD COLUMN IF NOT EXISTS alert_dismissed_at timestamptz;
