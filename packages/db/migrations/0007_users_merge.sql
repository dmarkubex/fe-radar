CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  action TEXT NOT NULL,
  actor_user_id BIGINT REFERENCES users(id),
  target_user_id BIGINT REFERENCES users(id),
  meta JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_logs_action_created_at_idx ON audit_logs(action, created_at);
CREATE INDEX IF NOT EXISTS audit_logs_target_user_idx ON audit_logs(target_user_id);
