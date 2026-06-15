DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'feedbacks_item_user_key') THEN
    ALTER TABLE feedbacks
      ADD CONSTRAINT feedbacks_item_user_key UNIQUE (item_id, user_id);
  END IF;
END $$;
