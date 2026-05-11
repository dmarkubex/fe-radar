ALTER TABLE feedbacks
  ADD CONSTRAINT feedbacks_item_user_key UNIQUE (item_id, user_id);
