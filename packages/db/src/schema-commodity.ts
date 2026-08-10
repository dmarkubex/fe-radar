import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique
} from "drizzle-orm/pg-core";

import { sources } from "./schema";
import { users } from "./schema";

// ---------------------------------------------------------------------------
// commodity_quotes
// 大宗商品时序数值（NFR-103：保留 365 天）
// raw_text: 应用层写入前必须 strip HTML 且截断 ≤2000 字符（Unicode code points）
//           schema 层仅声明 text 列，不做截断（沿用 v1.0 FR-12 硬约束）
// ---------------------------------------------------------------------------
export const commodityQuotes = pgTable("commodity_quotes", {
  id:          bigserial("id", { mode: "number" }).primaryKey(),
  metricKey:   text("metric_key").notNull(),
  value:       numeric("value", { precision: 18, scale: 4 }),
  changePct:   numeric("change_pct", { precision: 8, scale: 4 }),
  sourceId:    bigint("source_id", { mode: "number" }).notNull().references(() => sources.id),
  rawText:     text("raw_text"),
  observedAt:  timestamp("observed_at", { mode: "date", withTimezone: true }).notNull(),
  fetchedAt:   timestamp("fetched_at",  { mode: "date", withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  metricObservedUnique:   unique("commodity_quotes_metric_observed_key").on(table.metricKey, table.observedAt),
  metricObservedIdx:      index("commodity_quotes_metric_observed_idx").on(table.metricKey, table.observedAt)
}));

// ---------------------------------------------------------------------------
// commodity_briefings
// 简报记录（NFR-103：元数据 90 天，docx 文件随 MinIO retention）
// template_version: v0.4 fix M1 — 关联 design/templates/briefing.docx 版本号
// ---------------------------------------------------------------------------
export const commodityBriefings = pgTable("commodity_briefings", {
  id:              bigserial("id", { mode: "number" }).primaryKey(),
  briefingDate:    date("briefing_date").notNull().unique(),
  templateVersion: integer("template_version").notNull().default(1),
  payloadJson:     jsonb("payload_json").notNull(),
  docxPath:        text("docx_path"),
  genStatus:       text("gen_status").notNull(),
  genError:        text("gen_error"),
  generatedAt:     timestamp("generated_at", { mode: "date", withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  genStatusCheck:     check("commodity_briefings_gen_status_check", sql`${table.genStatus} IN ('pending','succeeded','failed','degraded')`),
  dateIdx:            index("commodity_briefings_date_idx").on(table.briefingDate),
  tplVersionIdx:      index("commodity_briefings_tpl_version_idx").on(table.templateVersion)
}));

// ---------------------------------------------------------------------------
// briefing_targets
// 推送目标（admin 后台维护）
// disabled_at: v0.4 fix M2 — 软删时间戳；管理后台"删除" = UPDATE disabled_at=now() + enabled=false
// ---------------------------------------------------------------------------
export const briefingTargets = pgTable("briefing_targets", {
  id:          bigserial("id", { mode: "number" }).primaryKey(),
  name:        text("name").notNull(),
  channel:     text("channel").notNull(),
  webhookUrl:  text("webhook_url").notNull(),
  signSecret:  text("sign_secret"),
  enabled:     boolean("enabled").notNull().default(true),
  disabledAt:  timestamp("disabled_at", { mode: "date", withTimezone: true }),
  createdBy:   bigint("created_by", { mode: "number" }).references(() => users.id),
  createdAt:   timestamp("created_at", { mode: "date", withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  channelCheck: check("briefing_targets_channel_check", sql`${table.channel} IN ('dingtalk_bot')`),
  // partial index: active targets only (v0.4 fix M2)
  activeIdx:    index("briefing_targets_active_idx").on(table.id).where(sql`${table.disabledAt} IS NULL`)
}));

// ---------------------------------------------------------------------------
// briefing_pushes
// 推送记录
// FK ON DELETE CASCADE: both briefing_id and target_id keep audit chain intact
// ---------------------------------------------------------------------------
export const briefingPushes = pgTable("briefing_pushes", {
  id:           bigserial("id", { mode: "number" }).primaryKey(),
  briefingId:   bigint("briefing_id", { mode: "number" }).notNull().references(() => commodityBriefings.id, { onDelete: "cascade" }),
  targetId:     bigint("target_id",   { mode: "number" }).notNull().references(() => briefingTargets.id,   { onDelete: "cascade" }),
  pushStatus:   text("push_status").notNull(),
  attemptCount: integer("attempt_count").notNull().default(0),
  errorDetail:  text("error_detail"),
  pushedAt:     timestamp("pushed_at", { mode: "date", withTimezone: true })
}, (table) => ({
  pushStatusCheck:   check("briefing_pushes_push_status_check", sql`${table.pushStatus} IN ('pending','succeeded','failed')`),
  briefingTargetUnique: unique("briefing_pushes_briefing_target_key").on(table.briefingId, table.targetId),
  statusIdx:         index("briefing_pushes_status_idx").on(table.pushStatus, table.pushedAt)
}));

// ---------------------------------------------------------------------------
// briefing_holidays
// 节假日表（admin 一年一次维护）
// ---------------------------------------------------------------------------
export const briefingHolidays = pgTable("briefing_holidays", {
  holidayDate: date("holiday_date").primaryKey(),
  name:        text("name").notNull(),
  createdAt:   timestamp("created_at", { mode: "date", withTimezone: true }).notNull().defaultNow()
});

// ---------------------------------------------------------------------------
// briefing_template_fields
// 模板字段映射（NFR-107：admin 可后台改）
// exactly_one_source CHECK: source_metric XOR llm_path XOR neither（静态占位）
// ---------------------------------------------------------------------------
export const briefingTemplateFields = pgTable("briefing_template_fields", {
  placeholderKey: text("placeholder_key").primaryKey(),
  label:          text("label").notNull(),
  sourceMetric:   text("source_metric"),
  llmPath:        text("llm_path"),
  fallbackText:   text("fallback_text").notNull().default("—"),
  isActive:       boolean("is_active").notNull().default(true)
}, (table) => ({
  exactlyOneSourceCheck: check(
    "briefing_template_fields_exactly_one_source_check",
    sql`(${table.sourceMetric} IS NOT NULL AND ${table.llmPath} IS NULL) OR (${table.sourceMetric} IS NULL AND ${table.llmPath} IS NOT NULL) OR (${table.sourceMetric} IS NULL AND ${table.llmPath} IS NULL)`
  )
}));

// ---------------------------------------------------------------------------
// daily_push_config
// 钉钉日报推送调度单例（id 固定为 1）
// enabled 默认 false：迁移/部署本身不得自动发消息
// send_time = 产业日报；briefing_send_time = 铜锂日报（0060 拆分，两者独立成卡）
// enabled 是两者共用的总开关。
// ---------------------------------------------------------------------------
export const dailyPushConfig = pgTable("daily_push_config", {
  // No DB DEFAULT on id (0055); singleton row is seeded with explicit id=1.
  id:               integer("id").primaryKey(),
  enabled:          boolean("enabled").notNull().default(false),
  sendTime:         text("send_time").notNull().default("16:15"),
  briefingSendTime: text("briefing_send_time").notNull().default("17:00"),
  scheduleMode: text("schedule_mode").notNull().default("business_days"),
  baseUrl:      text("base_url").notNull().default("http://fe-radar.internal"),
  updatedBy:    bigint("updated_by", { mode: "number" }).references(() => users.id),
  updatedAt:    timestamp("updated_at", { mode: "date", withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  singletonCheck:    check("daily_push_config_singleton_check", sql`${table.id} = 1`),
  sendTimeCheck:     check("daily_push_config_send_time_check", sql`${table.sendTime} ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'`),
  briefingSendTimeCheck: check("daily_push_config_briefing_send_time_check", sql`${table.briefingSendTime} ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'`),
  scheduleModeCheck: check("daily_push_config_schedule_mode_check", sql`${table.scheduleMode} IN ('daily','business_days')`)
}));

// ---------------------------------------------------------------------------
// daily_pushes
// 合并日报按日 / 按目标推送审计；UNIQUE(report_date, target_id) 保证幂等
// ---------------------------------------------------------------------------
export const dailyPushes = pgTable("daily_pushes", {
  id:                 bigserial("id", { mode: "number" }).primaryKey(),
  reportDate:         date("report_date").notNull(),
  targetId:           bigint("target_id", { mode: "number" }).notNull().references(() => briefingTargets.id),
  briefingId:         bigint("briefing_id", { mode: "number" }).references(() => commodityBriefings.id, { onDelete: "set null" }),
  dailyReportPresent: boolean("daily_report_present").notNull(),
  briefingPresent:    boolean("briefing_present").notNull(),
  pushStatus:         text("push_status").notNull(),
  attemptCount:       integer("attempt_count").notNull().default(0),
  errorDetail:        text("error_detail"),
  pushedAt:           timestamp("pushed_at", { mode: "date", withTimezone: true })
}, (table) => ({
  pushStatusCheck:       check("daily_pushes_push_status_check", sql`${table.pushStatus} IN ('pending','succeeded','failed')`),
  reportDateTargetUnique: unique("daily_pushes_report_date_target_key").on(table.reportDate, table.targetId),
  statusIdx:             index("daily_pushes_status_idx").on(table.pushStatus, table.pushedAt),
  reportDateIdx:         index("daily_pushes_report_date_idx").on(table.reportDate)
}));
