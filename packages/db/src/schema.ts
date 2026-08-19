import { relations, sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  bigserial,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  unique
} from "drizzle-orm/pg-core";

const vector = (name: string, dimensions: number) => {
  void dimensions;
  return text(name).$type<number[] | null>();
};

export const sources = pgTable("sources", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  name: text("name").notNull(),
  url: text("url").notNull().unique(),
  fetcherType: text("fetcher_type").notNull(),
  config: jsonb("config").notNull(),
  tier: text("tier").notNull(),
  category: text("category"),
  enabled: boolean("enabled").notNull().default(true),
  lastOkAt: timestamp("last_ok_at", { withTimezone: true }),
  failCount: integer("fail_count").notNull().default(0),
  lastError: text("last_error"),
  lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
  adminTouchedAt: timestamp("admin_touched_at", { withTimezone: true }),
  adminSnapshot: jsonb("admin_snapshot"),
  urlLocked: boolean("url_locked").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  fetcherTypeCheck: check("sources_fetcher_type_check", sql`${table.fetcherType} IN ('rss', 'html', 'playwright', 'quotes', 'announcement', 'crawl', 'datapro', 'websearch')`),
  tierCheck: check("sources_tier_check", sql`${table.tier} IN ('T1', 'T2', 'T3')`),
  enabledTierIdx: index("sources_enabled_tier_idx").on(table.enabled, table.tier),
  categoryIdx: index("sources_category_idx").on(table.category),
  lastOkAtIdx: index("sources_last_ok_at_idx").on(table.lastOkAt),
  failCountIdx: index("sources_fail_count_idx").on(table.failCount)
}));

export const entities = pgTable("entities", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  type: text("type").notNull(),
  canonicalName: text("canonical_name").notNull(),
  aliases: text("aliases").array().notNull().default(sql`'{}'::text[]`),
  circle: text("circle"),
  weight: real("weight").notNull().default(1),
  meta: jsonb("meta")
}, (table) => ({
  typeCanonicalUnique: unique("entities_type_canonical_name_key").on(table.type, table.canonicalName),
  circleCheck: check("entities_circle_check", sql`${table.circle} IS NULL OR ${table.circle} IN ('C1', 'C2', 'C3')`),
  aliasesGin: index("entities_aliases_gin").using("gin", table.aliases)
}));

export const entityFinancials = pgTable("entity_financials", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  entityId: bigint("entity_id", { mode: "number" }).notNull().references(() => entities.id, { onDelete: "cascade" }),
  metric: text("metric").notNull(),
  value: numeric("value", { precision: 20, scale: 4 }),
  period: text("period").notNull(),
  observedAt: timestamp("observed_at", { withTimezone: true }),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  entityMetricPeriodUnique: unique("entity_financials_entity_metric_period_key").on(table.entityId, table.metric, table.period),
  entityObservedIdx: index("entity_financials_entity_observed_idx").on(table.entityId, table.observedAt.desc())
}));

export const items = pgTable("items", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  sourceId: bigint("source_id", { mode: "number" }).notNull().references(() => sources.id),
  url: text("url").notNull().unique(),
  title: text("title").notNull(),
  content: text("content"),
  lang: text("lang"),
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  publishedAtIdx: index("items_published_at_idx").on(table.publishedAt),
  ftsIdx: index("items_fts_idx").using("gin", sql`to_tsvector('zhparser', coalesce(${table.title}, '') || ' ' || coalesce(${table.content}, ''))`)
}));

export const itemAnalysis = pgTable("item_analysis", {
  itemId: bigint("item_id", { mode: "number" }).primaryKey().references(() => items.id, { onDelete: "cascade" }),
  isIndustryRelated: boolean("is_industry_related"),
  summaryZh: text("summary_zh"),
  translationZh: text("translation_zh"),
  d1Policy: real("d1_policy"),
  d2Chain: real("d2_chain"),
  d3Market: real("d3_market"),
  d4Tech: real("d4_tech"),
  d5Business: real("d5_business"),
  qualityScore: real("quality_score"),
  category: text("category"),
  topCircle: text("top_circle"),
  isCurated: boolean("is_curated").notNull().default(false),
  alertLevel: text("alert_level"),
  alertType: text("alert_type"),
  quotaState: text("quota_state").default("admitted"),
  embedding: vector("embedding", 1024),
  scoredAt: timestamp("scored_at", { withTimezone: true }),
  alertDismissedAt: timestamp("alert_dismissed_at", { withTimezone: true })
}, (table) => ({
  quotaStateCheck: check("item_analysis_quota_state_check", sql`${table.quotaState} IN ('admitted', 'pending_over_quota', 'dropped_quota_expired', 'dropped_filter')`),
  qualityIdx: index("analysis_quality_idx").on(table.qualityScore).where(sql`${table.isCurated}`),
  embeddingIdx: index("analysis_emb_idx").using("ivfflat", sql`${table.embedding} vector_cosine_ops`)
}));

export const itemEntities = pgTable("item_entities", {
  itemId: bigint("item_id", { mode: "number" }).notNull().references(() => items.id, { onDelete: "cascade" }),
  entityId: bigint("entity_id", { mode: "number" }).notNull().references(() => entities.id),
  span: text("span")
}, (table) => ({
  pk: primaryKey({ columns: [table.itemId, table.entityId] })
}));

export const clusters = pgTable("clusters", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  centroid: vector("centroid", 1024),
  leadItemId: bigint("lead_item_id", { mode: "number" }).references(() => items.id, { onDelete: "set null" }),
  eventType: text("event_type"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const clusterItems = pgTable("cluster_items", {
  clusterId: bigint("cluster_id", { mode: "number" }).notNull().references(() => clusters.id, { onDelete: "cascade" }),
  itemId: bigint("item_id", { mode: "number" }).notNull().references(() => items.id, { onDelete: "cascade" }),
  similarity: real("similarity")
}, (table) => ({
  pk: primaryKey({ columns: [table.clusterId, table.itemId] })
}));

export const dailyReports = pgTable("daily_reports", {
  date: date("date").primaryKey(),
  sections: jsonb("sections").notNull(),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow()
});

export const users = pgTable("users", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  username: text("username").unique(),
  passwordHash: text("password_hash"),
  dingtalkId: text("dingtalk_id").unique(),
  name: text("name").notNull(),
  dept: text("dept"),
  role: text("role").notNull().default("viewer"),
  mergedAt: timestamp("merged_at", { withTimezone: true }),
  mergedFromUserId: bigint("merged_from_user_id", { mode: "number" }).references((): AnyPgColumn => users.id),
  disabledAt: timestamp("disabled_at", { withTimezone: true }),
  // T-SEC-06: JWT 撤权版本号。禁用/降权/改密码/合并时递增；特权请求校验 token 内
  // tokenVersion 与 DB 当前值一致，不符即 401。默认 0，登录时写入当前值。
  tokenVersion: integer("token_version").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  credentialsCheck: check("users_credentials_check", sql`(${table.username} IS NOT NULL AND ${table.passwordHash} IS NOT NULL) OR ${table.dingtalkId} IS NOT NULL`),
  roleCheck: check("users_role_check", sql`${table.role} IN ('viewer', 'editor', 'admin')`),
  activeIdx: index("users_active_idx").on(table.id).where(sql`${table.disabledAt} IS NULL`)
}));

export const mergeConflicts = pgTable("merge_conflicts", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  unionid: text("unionid").notNull(),
  name: text("name").notNull(),
  dept: text("dept"),
  candidateIds: bigint("candidate_ids", { mode: "number" }).array().notNull(),
  status: text("status").notNull().default("pending"),
  resolvedBy: bigint("resolved_by", { mode: "number" }).references(() => users.id),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  statusCheck: check("merge_conflicts_status_check", sql`${table.status} IN ('pending', 'confirmed', 'rejected')`),
  statusIdx: index("merge_conflicts_status_idx").on(table.status, table.createdAt)
}));

// T-SEC-09: 项目代号权威字典 — scrubber PROJECT_CODE 脱敏的数据源。
// admin 后台维护；loader 5min 缓存。disabled_at 软删保留审计。
export const projectCodes = pgTable("project_codes", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  code: text("code").notNull().unique(),
  note: text("note"),
  disabledAt: timestamp("disabled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  activeIdx: index("project_codes_active_idx").on(table.code).where(sql`${table.disabledAt} IS NULL`)
}));

export const auditLogs = pgTable("audit_logs", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  action: text("action").notNull(),
  actorUserId: bigint("actor_user_id", { mode: "number" }).references(() => users.id),
  targetUserId: bigint("target_user_id", { mode: "number" }).references(() => users.id),
  meta: jsonb("meta"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  actionIdx: index("audit_logs_action_created_at_idx").on(table.action, table.createdAt),
  targetIdx: index("audit_logs_target_user_idx").on(table.targetUserId)
}));

export const feedbacks = pgTable("feedbacks", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  itemId: bigint("item_id", { mode: "number" }).references(() => items.id, { onDelete: "cascade" }),
  userId: bigint("user_id", { mode: "number" }).references(() => users.id),
  vote: smallint("vote"),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  voteCheck: check("feedbacks_vote_check", sql`${table.vote} IN (-1, 0, 1)`),
  itemUserUnique: unique("feedbacks_item_user_key").on(table.itemId, table.userId)
}));

export const scoringConfig = pgTable("scoring_config", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: bigint("updated_by", { mode: "number" }).references(() => users.id)
});

export const scoringReprocessRuns = pgTable("scoring_reprocess_runs", {
  runId: text("run_id").primaryKey(),
  fromAt: timestamp("from_at", { withTimezone: true }).notNull(),
  untilAt: timestamp("until_at", { withTimezone: true }).notNull(),
  status: text("status").notNull().default("prepared"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true })
}, (table) => ({
  statusCheck: check("scoring_reprocess_runs_status_check", sql`${table.status} IN ('prepared', 'running', 'completed', 'failed')`),
  windowCheck: check("scoring_reprocess_runs_window_check", sql`${table.fromAt} < ${table.untilAt}`),
  statusCreatedIdx: index("scoring_reprocess_runs_status_created_idx").on(table.status, table.createdAt.desc())
}));

export const scoringReprocessTargets = pgTable("scoring_reprocess_targets", {
  runId: text("run_id").notNull().references(() => scoringReprocessRuns.runId, { onDelete: "cascade" }),
  itemId: bigint("item_id", { mode: "number" }).notNull().references(() => items.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  pk: primaryKey({ columns: [table.runId, table.itemId] }),
  statusCheck: check("scoring_reprocess_targets_status_check", sql`${table.status} IN ('pending', 'running', 'completed', 'failed', 'skipped_filter', 'pending_quota')`),
  attemptsCheck: check("scoring_reprocess_targets_attempts_check", sql`${table.attempts} >= 0`),
  runStatusUpdatedIdx: index("scoring_reprocess_targets_run_status_updated_idx").on(table.runId, table.status, table.updatedAt),
  itemIdx: index("scoring_reprocess_targets_item_idx").on(table.itemId)
}));

export const sourceRelations = relations(sources, ({ many }) => ({
  items: many(items)
}));

export const itemRelations = relations(items, ({ one, many }) => ({
  source: one(sources, { fields: [items.sourceId], references: [sources.id] }),
  analysis: one(itemAnalysis, { fields: [items.id], references: [itemAnalysis.itemId] }),
  entities: many(itemEntities),
  clusters: many(clusterItems),
  feedbacks: many(feedbacks)
}));

export const userRelations = relations(users, ({ many }) => ({
  feedbacks: many(feedbacks),
  resolvedMergeConflicts: many(mergeConflicts)
}));

export const entityFinancialsRelations = relations(entityFinancials, ({ one }) => ({
  entity: one(entities, { fields: [entityFinancials.entityId], references: [entities.id] })
}));

// ---------------------------------------------------------------------------
// v1.3 Copilot（spec/v1.3-copilot-agent/design.md §7，migration 0064）
// 角色不在此处：copilot_app 由 migrate.ts 在 runMigrations 之前非事务创建。
// copilot.visible_items 视图只存在于 SQL（可见性单一来源），Drizzle 不镜像。
// ---------------------------------------------------------------------------
export const copilotSchema = pgSchema("copilot");

export const copilotSessions = copilotSchema.table("sessions", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: bigint("user_id", { mode: "number" }).notNull().references(() => users.id),
  title: text("title"),
  source: text("source").notNull(),
  // source='item' 时创建由应用写入；items 90 天清理后置 NULL（对话保留）
  itemId: bigint("item_id", { mode: "number" }).references(() => items.id, { onDelete: "set null" }),
  lastActive: timestamp("last_active", { withTimezone: true }).notNull().defaultNow(),
  turnLockedAt: timestamp("turn_locked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  sourceCheck: check("sessions_source_check", sql`${table.source} IN ('ask', 'item')`),
  userLastIdx: index("sessions_user_last_idx").on(table.userId, table.lastActive.desc())
}));

// 全文只经 worker（POSTGRES_USER）写、Python 经 worker HTTP 读
export const copilotItemFulltext = copilotSchema.table("item_fulltext", {
  itemId: bigint("item_id", { mode: "number" }).primaryKey().references(() => items.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  truncated: boolean("truncated").notNull().default(false),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull()
});

export const copilotMessages = copilotSchema.table("messages", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  sessionId: bigint("session_id", { mode: "number" }).notNull().references(() => copilotSessions.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  citations: jsonb("citations").notNull().default(sql`'[]'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  roleCheck: check("messages_role_check", sql`${table.role} IN ('user', 'assistant')`),
  sessionIdx: index("messages_session_id_idx").on(table.sessionId, table.id.desc())
}));

export const copilotAuditLog = copilotSchema.table("audit_log", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: bigint("user_id", { mode: "number" }).notNull().references(() => users.id),
  sessionId: bigint("session_id", { mode: "number" }).references(() => copilotSessions.id, { onDelete: "set null" }),
  messageId: bigint("message_id", { mode: "number" }).references(() => copilotMessages.id, { onDelete: "set null" }),
  toolName: text("tool_name"),
  argsPreview: text("args_preview"),
  resultPreview: text("result_preview"),
  resultRowCount: integer("result_row_count"),
  tokenUsage: jsonb("token_usage"),
  coverage: text("coverage").notNull().default("ok"),
  aborted: boolean("aborted").notNull().default(false),
  numbersUngrounded: integer("numbers_ungrounded").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  coverageCheck: check("audit_log_coverage_check", sql`${table.coverage} IN ('none', 'ok')`),
  messageIdx: index("audit_log_message_id_idx").on(table.messageId)
}));

export const copilotFeedbacks = copilotSchema.table("feedbacks", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  messageId: bigint("message_id", { mode: "number" }).notNull().references(() => copilotMessages.id, { onDelete: "cascade" }),
  userId: bigint("user_id", { mode: "number" }).notNull().references(() => users.id),
  rating: smallint("rating").notNull(),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  ratingCheck: check("feedbacks_rating_check", sql`${table.rating} IN (-1, 1)`),
  messageUserUnique: unique("feedbacks_message_user_key").on(table.messageId, table.userId)
}));

// 灰度开关：判定只在 web（copilot_app 无此表权限）；seed 走 0064 ON CONFLICT DO NOTHING
export const copilotFeatureFlags = copilotSchema.table("feature_flags", {
  key: text("key").primaryKey(),
  enabled: boolean("enabled").notNull().default(false),
  userIds: bigint("user_ids", { mode: "number" }).array().notNull().default(sql`'{}'::bigint[]`),
  depts: text("depts").array().notNull().default(sql`'{}'::text[]`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: bigint("updated_by", { mode: "number" }).references(() => users.id)
});
