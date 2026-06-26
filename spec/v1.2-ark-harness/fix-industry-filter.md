# 修复计划 v2 — 时间线行业相关性筛选失效（C3 噪音 / C1·C2 空）

> v2：吸收 codex + mimo 方案评审的 3 个阻断点与 5 条建议（详见末尾「评审修订记录」）。

## 背景与根因（已查证代码）

1. **prefilter 闸门没接到展示层**：`item_analysis.isIndustryRelated` 在 `apps/worker/src/handlers/prefilter.ts:32` 写入，但 `apps/web/lib/api/timeline-query.ts` 默认 where 从不读它 → 时间线 = 全量抓取结果。
2. **prefilter 失败语义错**：`isIndustryRelated: result.isIndustryRelated === true`，LLM `"unknown"`/失败时落成 `false`（无法区分"判否"与"判不了"）。
3. **topCircle 默认 C3**：`packages/core/src/scoring.ts:81-90` `pickTopCircle` reduce 初始值 `"C3"`，无实体命中即兜底 C3 → 全屏 C3、C1/C2 空。
4. **信源本身杂**：「凤凰财经-能源」是泛财经 RSS，混大盘/外汇/股市。

## 目标

时间线默认只展示「行业相关」条目；LLM 故障时不误杀（fail-open）；命中 C1/C2 或带告警的条目**永不被行业闸门隐藏**（守住"自家公司零漏报"硬约束）；信源层用脚本关键词预过滤减少 LLM 调用。

## 修复范围（3 项 + 测试；topCircle 徽标语义本期不动）

### Fix-1　prefilter 三态 + fail-open（worker）

- 文件：`apps/worker/src/handlers/prefilter.ts`
- 改：`isIndustryRelated` 落库改三态——LLM 明确 `true`→`true`，明确 `false`→`false`，`"unknown"`/失败→`null`（未决，fail-open）。
- 约束：不改 `runPrefilter` 返回契约（仍可返回 `"unknown"`）；只改 handler 落库映射。`item_analysis.is_industry_related` 已是 **nullable boolean**（`packages/db/src/schema.ts`，无 NOT NULL），写 `null` 合法，**无需 ALTER COLUMN**。
- 测试：handler 单测三分支（`true`→true / `false`→false / `"unknown"`→null）。

### Fix-2　时间线行业闸门 + 零漏报豁免（web）

- 文件：`apps/web/lib/api/timeline-query.ts`、`apps/web/lib/api/timeline-schema.ts`
- **schema**：在 `timelineQuerySchema`（**与 `includeBlocked` 并列**，line 34-38 一带）加 `includeNonIndustry: queryBoolean.default(false)`。**不要**放进 `timelineFilterSchema`（避免进入 `TimelineFilters` 类型流入条件构建）。
- **列表闸门**：默认（`includeNonIndustry=false`）在列表 where 增加——
  ```
  isIndustryRelated IS NOT FALSE
  OR topCircle IN ('C1','C2')
  OR alertType IS NOT NULL
  ```
  用 drizzle `sql\`${itemAnalysis.isIndustryRelated} IS NOT FALSE\``处理三值逻辑（**不要**用`ne(x,false)`，对 NULL 会误排除）。`includeNonIndustry=true` 时不加此条件（admin/调试看全量）。
- **穿层管线（精确签名，阻断点①/plumbing 修复）** —— `includeNonIndustry` 必须从 handler 一路传到 `visibleItemConditions`，**不得混进 `filters`(TimelineFilters)**：
  1. `visibleItemConditions(filters, includeBlocked, cursor?, search?, useFts=true)`（line 151）→ **末尾加第 6 个位置参 `includeNonIndustry = false`**；行业条件 `includeNonIndustry ? undefined : sql\`(${itemAnalysis.isIndustryRelated} IS NOT FALSE OR ${itemAnalysis.topCircle} IN ('C1','C2') OR ${itemAnalysis.alertType} IS NOT NULL)\``。
  2. `fetchRows(db, options)`（line 246）→ options 加 `includeNonIndustry?: boolean`，内部调 `visibleItemConditions(...)`（line 287）把它作第 6 参透传。
  3. `fetchTimeline(options)`（line 304）→ options 加 `includeNonIndustry?: boolean`，**两处 `fetchRows` 调用（主路径 line 320 + FTS 降级 catch line 333）都要透传**（漏掉降级路径会让搜索时闸门失效）。
  4. **handler（`apps/web/app/api/timeline/route.ts` + `apps/web/app/api/search/route.ts`）**：safeParse 输入加 `includeNonIndustry: searchParams.get("includeNonIndustry") ?? undefined`；调用 `fetchTimeline` 时**单独传** `includeNonIndustry: canIncludeBlocked(user.role, parsed.data.includeNonIndustry)`（admin 门控，与 `includeBlocked` 同款），**不要**依赖它混在 `filters: parsed.data` 里。
  5. **详情豁免**：`fetchItemDetail`（line 406）当前 `visibleItemConditions({}, options.includeBlocked ?? false)` → 改为 `visibleItemConditions({}, options.includeBlocked ?? false, undefined, undefined, true, /* includeNonIndustry */ true)`，使按 ID 直访**永不**被行业闸门拦（否则 admin 看全量列表点入会 404）。即行业闸门**仅作用于列表查询**。
- 范围：**仅主时间线列表**。alerts（已按 alertType 过滤）、featured/日报（已按 isCurated）不动。
- 测试：① 明确 false 被隐藏；② **NULL（未决/LLM 故障）→展示（fail-open 集成用例）**；③ true→展示；④ false 但 topCircle=C2 仍展示；⑤ false 但 alertType 非空仍展示；⑥ `includeNonIndustry=true` 全展示；⑦ **fetchItemDetail 对 isIndustryRelated=false 且无豁免的条目仍返回（不 404）**。

### Fix-3　信源级关键词白名单（脚本预过滤，worker）

- 文件：`apps/worker/src/fetchers/types.ts`、`apps/worker/src/handlers/fetch.ts`
- **类型**：**本期仅给 `RssSourceConfig` 加** `keywordFilter?: string[]`（其它源类型后续按需跟进，不在本期）。
- **过滤位置（阻断点③修复）**：在 `fetch.ts` **`rawItems` 抓取成功后（line 79 之后）、构建 `candidates`（line 81）之前**对 `rawItems` 过滤——`pre-dedup`，让 dedup/DB 查询只处理已过滤集。
- **类型收窄**：`if (config.type === 'rss' && config.keywordFilter?.length)` 再过滤（避免对 `SourceConfig` 全联合直接访问 `keywordFilter` 触发 TS 错误 / `as any` 绕过）。
- **匹配**：标题+正文大小写无关「包含任一关键词」即保留；无任一命中 → 丢弃（只记结构化 warn 日志，不写 item）。
- **空/缺省语义**：`keywordFilter` 缺省 **或 `[]` 空数组**一律视为「不过滤」（全保留）。
- 数据：新增迁移 `0031`，给「凤凰财经-能源」源 config 合并 `keywordFilter` 起始词表（admin 后台可改）：
  `电力,电网,电缆,电线,输配电,特高压,变压器,储能,能源,光伏,风电,新能源,锂电,锂电池,碳酸锂,铜,有色,稀土,充电桩,电池,电工,远东`
  - **幂等 + admin 改动幸存（建议采纳）**：`UPDATE sources SET config = config || '{"keywordFilter":[...]}'::jsonb WHERE name='凤凰财经-能源' AND (config->'keywordFilter') IS NULL;` —— 仅首次写入，已有值不覆盖；改版词表走新 migration。
- 测试：fetch handler 单测——有 keywordFilter 时无命中条目被丢、命中保留；`keywordFilter` 缺省或 `[]` 时全保留。

## 不在本期范围

- topCircle「无命中 vs C3」徽标语义修正（跨 core/db/ui，纯展示，单列）。
- 信源增删替换（admin 决策，不在代码）。

## 已知残余风险（评审确认，显式记录）

- **C3 不豁免是有意为之**：C3 是 `pickTopCircle` 的兜底默认值，豁免 C3 等于关闭过滤（绝大多数条目都是 C3）。因此 C3 不进豁免名单。
- **自家公司零漏报的依赖链**：保护来自「自家公司 seed 为 C1 实体 + NER 命中 → topCircle=C1 → 被豁免」。**残余风险**：若 NER 漏掉真实 C1 实体，该条目 topCircle 退化为 C3，且若 prefilter 明确判 `false`，会被行业闸门隐藏。这是 **NER 召回问题**（非本闸门设计问题），单列跟踪，不在本期范围；本期通过 fail-open（`null` 放行）已覆盖"LLM 判不了"的情况，只有"LLM 明确判否 + NER 漏 C1"双重失误才会漏，概率低且与本修复正交。

## 项目不变量（执行器必须遵守）

- `apps/web` 与 `apps/worker` 不互相 import；跨 package 经 `index.ts`；`packages/core` 不依赖 `packages/db`。
- 迁移幂等；不改既有迁移文件，新增 `0031`。
- 时区 `dayjs().tz(APP_TIMEZONE)`；commit 格式 `[T-FILT-XX] 动词 + 范围`。
- TS 严格、无未使用变量（husky `eslint --max-warnings=0` 会拦，禁止 `as any` 绕类型）；spec/md 过 prettier。
- 守住硬约束：行业闸门必须豁免 C1/C2/告警条目。

## 验收

- `pnpm -r test` 全绿；`pnpm -r lint` 无 error。
- 时间线默认不再出现「美元转折点/日本股市」这类无产业关联条目；命中 C1/C2 或告警的条目不受影响。
- LLM 故障演练（prefilter 全 `null`）：时间线仍有内容（fail-open），不空屏。
- 详情页对被列表闸门隐藏的条目仍可按 ID 打开（不 404）。

## 评审修订记录（v1→v2）

- **阻断①(codex)**：fetchItemDetail 共用条件会误杀详情 → 详情路径硬传 `includeNonIndustry:true`，闸门仅作用列表。
- **阻断②(mimo)**：C3 是否豁免 → 显式声明 C3 不豁免为有意为之 + 记录零漏报依赖链与残余 NER 风险。
- **阻断③(mimo)**：Fix-3 插入点歧义 → 明确 `rawItems` 抓取后(line 79)、candidates(line 81) 前，pre-dedup。
- 建议(codex)：0031 加 `(config->'keywordFilter') IS NULL` 守卫；`includeNonIndustry` 放 `timelineQuerySchema`；rss 类型收窄；记录 pickTopCircle 残余风险。
- 建议(mimo)：补 NULL→展示集成测试；确认列 nullable（已确认，无需 ALTER）；仅扩 RssSourceConfig；`[]` 空数组=不过滤。
