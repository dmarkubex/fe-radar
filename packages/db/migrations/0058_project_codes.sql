-- 0058_project_codes.sql
-- T-SEC-09: scrubber 的 PROJECT_CODE 脱敏逻辑（packages/core/src/scrubber.ts）依赖
-- context.projectCodes 字典，但仓库里没有任何生产调用方加载字典，内部项目代号会原样
-- 进入公网 LLM。新建 project_codes 表作为权威字典源，admin 后台维护，loader 5min 缓存。
--
-- 表结构：code 唯一、可软删（disabled_at）、note 备注。空表起步（不预置代号，避免
-- 把真实代号写进仓库；admin 上线后在后台补）。
--
-- ROLLBACK (manual only — do not auto-run):
--   DROP TABLE IF EXISTS project_codes;

BEGIN;

CREATE TABLE IF NOT EXISTS project_codes (
  id           BIGSERIAL PRIMARY KEY,
  code         TEXT NOT NULL UNIQUE,
  note         TEXT,
  disabled_at  TIMESTAMP WITH TIME ZONE,
  created_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS project_codes_active_idx
  ON project_codes (code)
  WHERE disabled_at IS NULL;

COMMIT;
