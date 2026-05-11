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
  url: text("url").notNull(),
  fetcherType: text("fetcher_type").notNull(),
  config: jsonb("config").notNull(),
  tier: text("tier").notNull(),
  category: text("category"),
  enabled: boolean("enabled").notNull().default(true),
  lastOkAt: timestamp("last_ok_at", { withTimezone: true }),
  failCount: integer("fail_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  fetcherTypeCheck: check("sources_fetcher_type_check", sql`${table.fetcherType} IN ('rss', 'html', 'playwright')`),
  tierCheck: check("sources_tier_check", sql`${table.tier} IN ('T1', 'T2', 'T3')`)
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
  scoredAt: timestamp("scored_at", { withTimezone: true })
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

export const feedbacks = pgTable("feedbacks", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  itemId: bigint("item_id", { mode: "number" }).references(() => items.id, { onDelete: "cascade" }),
  userId: bigint("user_id", { mode: "number" }).references(() => users.id),
  vote: smallint("vote"),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  voteCheck: check("feedbacks_vote_check", sql`${table.vote} IN (-1, 0, 1)`)
}));

export const scoringConfig = pgTable("scoring_config", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: bigint("updated_by", { mode: "number" }).references(() => users.id)
});

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
