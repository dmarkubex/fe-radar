# 时间线事件轴升级 — 任务卡 (timeline-event-axis)

> 目标:首页 `/` 时间线从「弱按天分组的卡片堆」升级为**真正的事件时间线**(按 publishedAt 事件时间轴 + 日/时段节点)。
> 用户已拍板:轴=publishedAt;节点=日(今天/昨天/日期,吸顶)+ 日内 publishedAt 时段带(凌晨/上午/下午/晚间);修 TZ bug。
> 模式:Standard(跨 web-api + web-ui,中风险——keyset 游标分页易踩坑)。
> 验收门槛:typecheck + `pnpm -r test` 全绿;mimo 代码评审 APPROVE;主会话复审通过。产物标 `needs_human_review`。

## 范围总览

| 卡      | 主题                                                          | scope                                                              | owner         |
| ------- | ------------------------------------------------------------- | ------------------------------------------------------------------ | ------------- |
| T-TL-01 | API:默认时间线排序→publishedAt + (publishedAt,id) keyset 游标 | `timeline-query.ts` `cursor.ts` `mock-data.ts` + query/cursor 测试 | 核心 → codex  |
| T-TL-02 | UI:TZ 正确的日+时段节点、今天/昨天、吸顶、竖轴、卡片标时分    | `timeline-list.tsx` `timeline-card.tsx`(必要时 `meta.ts`)+ 测试    | 标准 → GLM/pi |

## 合规红线 / 不变量(全卡,违反=驳回)

- **TZ 一律 `@fe-radar/shared` 的 `dayjs().tz('Asia/Shanghai')`**;禁 `new Date().toISOString().slice(0,10)` / `toLocaleString` 这类隐式时区。
- **可见性过滤不动**:`isNotNull(itemAnalysis.scoredAt)` 等条件保持(只展示处理完的);本批次只改**排序键与游标**,不改可见过滤。
- **curated 分支保持原样**:`filters.curated` 时仍 `desc(qualityScore)` + 其现有游标行为,**一字不改**(它现有 keyset 用 scoredAt 与排序键不一致是既有遗留,不在本批次修)。
- 不存原始 HTML;现有筛选栏 / 详情弹窗 / feedback / 搜索 / alerts 复用 timeline-query 的路径**不得回归**。
- 设计 token 沿用现有(`rounded-none`/`text-fg|fg-soft|accent`/`font-mono`/`border-hairline` 等)。
- commit:`[T-TL-0X] 动词 + 范围`。
- **publishedAt fallback 已接受(评审决议)**:部分源解析不到发布时间会 fallback 成抓取时刻(`html.ts`/`playwright.ts`/`rss.ts`),这类条目"事件时间"≈入库时间。**本批次接受此偏差,不做源日期质量门控、不改 fetcher**;UI 标注"发布时间未知"留作未来可选项(不在本批次)。

---

## T-TL-01 — API:默认时间线改 publishedAt 事件轴 + keyset 游标

- **goal**:把**默认**时间线(非 curated)的排序与游标分页从 `scoredAt` 切到 `publishedAt`,用 `(publishedAt, id)` 复合 keyset,保证翻页不漏/不重。
- **constraints**:
  - **排序**(`timeline-query.ts:170`):默认分支 `desc(items.publishedAt), desc(items.id)`;**curated 分支不动**(`desc(itemAnalysis.qualityScore)` + 现状)。
  - **keyset 游标**(`visibleItemConditions` cursor 段 `:88-92`):默认分支用 `or(lt(items.publishedAt, P), and(eq(items.publishedAt, P), lt(items.id, id)))`;`items.publishedAt` 为 NOT NULL,游标恒可编码。
  - **cursor 设计(已定:泛化 `{ at, id }`,模式感知 keyset)**——`cursor.ts` 被默认时间线、curated、**以及 alerts(`alerts-query.ts:9,25,85`)共用**,故**不得**改成 publishedAt-only:
    - `CursorPayload` 泛化为 `{ at: string; id: number }`(`at` = 该模式 keyset 排序值的 ISO 字符串);`decodeCursor` 校验 `at`+`id`。
    - **keyset 列由调用方按模式决定**(不是由 cursor 决定):默认时间线 keyset on `items.publishedAt`(与新 orderBy 一致),`at`=publishedAt;**curated keyset on `itemAnalysis.scoredAt`**(保持现状,连同其"orderBy=qualityScore 但 keyset=scoredAt"的既有遗留一并不动),`at`=scoredAt;**alerts keyset on `scoredAt`**(现状不变),`at`=scoredAt。
    - **curated / alerts 仅 cursor codec 字段名机械适配**(`scoredAt → at`、值仍 scoredAt ISO、**keyset 列与 orderBy 一律不变**)→ **行为零变化**。**禁止**顺手"修" curated 的 keyset/orderBy 既有不一致。("一字不改"指 orderBy+keyset 逻辑;字段名适配是 codec 泛化的必然连带。)
  - **encodeCursor**(`timeline-query.ts:218`):默认分支用 `last.publishedAt`(NOT NULL,恒可编码)生成 nextCursor;curated 分支仍用 scoredAt;`nextCursor` 仅当 `rows.length > limit` 时给出。
  - **可见性条件不动**(`isNotNull(itemAnalysis.scoredAt)` 等)。
  - **索引(已定:沿用现有,不新建)**:`items_published_at_idx`(publishedAt 单列,`schema.ts:73`)已存在;`items` 受 90 天保留上界、行数有界,单列索引足够支撑 `ORDER BY publishedAt DESC, id DESC` 的 keyset(同 publishedAt 内按 id 的二次排序量极小)。**本批次不新建复合索引、不加 migration**;`(published_at DESC, id DESC)` 复合索引留作未来可选优化。
  - **keyset 条件简化**:`items.publishedAt` 为 NOT NULL,keyset 无需 null 防护分支,直接 `or(lt(publishedAt,P), and(eq(publishedAt,P), lt(id,I)))`。
  - **search / /items 排序(已定:跟随 publishedAt)**:`/api/search`、`/search`、`/items?q=` 均经 `fetchTimeline`(`search/route.ts:26`、`items/page.tsx:18`、`search/page.tsx:24`),默认 fetchRows 改 publishedAt 后它们**一并按 publishedAt desc,id desc**(与现状"按 scoredAt 时间序"同为时间序、非相关度,语义一致,采纳)。**必须在 acceptance 覆盖 search 排序 + 游标断言**。
  - **alerts 查询独立**:`alerts-query.ts` 有独立 query(不复用 fetchRows/fetchTimeline),其排序/keyset **不改**;只因共用 `cursor.ts` 做上面的字段机械适配。
  - **mock**(`mock-data.ts` `mockFetchTimeline`):① items 的 publishedAt **跨 ≥3 天、每天 ≥2 个时段带**(供 UI 在 mock 模式验证日/时段节点);② `mockFetchTimeline` **新增接受 `cursor` 参数**以模拟翻页(供 keyset 与 UI 跨页合并验证)。
- **ask_agent_first**:泛化 `{at,id}` 后,确保三处调用各自 keyset 列与其 orderBy 自洽(默认 publishedAt;curated/alerts 仍 scoredAt);旧 `{scoredAt,id}` cursor 部署后全模式一次性 decode→null→回第 1 页(可接受,见 acceptance)。
- **owner**:核心 → `codex:codex-rescue`。
- **scope**:`apps/web/lib/api/timeline-query.ts`、`apps/web/lib/api/cursor.ts`、`apps/web/lib/api/alerts-query.ts`(仅 cursor 字段机械适配 scoredAt→at)、`apps/web/lib/mock-data.ts`、相关 `__tests__`(timeline-query 游标、cursor 编解码、alerts 游标回归)。**不**改 timeline-schema、route、UI。
- **rollback**:还原上述文件。
- **acceptance**:
  1. 默认时间线按 publishedAt 倒序;同 publishedAt 用 id 倒序 tie-break。
  2. **keyset 游标测试**:构造同 publishedAt 多条 + 跨页,断言翻页**无重复、无遗漏**(尤其同 publishedAt 边界)。
  3. **curated 分支排序与游标与改动前完全一致**(回归断言:orderBy=qualityScore、keyset 仍 on scoredAt、值不变)。
  4. **alerts 分页回归**:`alerts-query` 经 cursor 字段适配后,排序/keyset/翻页行为与改动前一致(回归断言)。
  5. **search 排序**:search 分支(`fetchTimeline({search})`)按 publishedAt desc,id desc;search + cursor 翻页无重复无遗漏(断言)。
  6. 可见性(scoredAt 非空)与现有筛选条件不回归。
  7. **mock**:`mockFetchTimeline` 返回 ≥3 天、每天 ≥2 时段带的数据,且接受 `cursor` 参数模拟翻页;**mock 的 cursor 处理须镜像真实 keyset 语义**(同 publishedAt 用 id tie-break),不可是平凡 stub(断言数据形状 + 翻页无重叠)。
  8. 旧 `{scoredAt,id}` cursor 解码安全回退(返回 null,不抛错)= 部署后持旧 cursor 的少量用户翻页回到第 1 页(全模式一致、一次性、可接受)。
  9. **cursor 正向 roundtrip 断言**:`encodeCursor→decodeCursor` 在三模式下还原正确——默认 `{at:publishedAt,id}`、curated `{at:scoredAt,id}`、alerts `{at:scoredAt,id}`。
  10. typecheck 0 error;web 包 test 绿。

---

## T-TL-02 — UI:日+时段时间节点、今天/昨天、吸顶、竖轴

> **depends_on: T-TL-01**(消费 publishedAt 排序与新 cursor 格式)。可与 T-TL-01 并行开发(UI 分组只依赖 DTO 里已有的 `publishedAt` 字段,接口契约不变),但**集成验证须在 T-TL-01 合入后**。

- **goal**:把 `timeline-list.tsx` 的弱分组重做成时间轴:**粗节点=日期**(今天/昨天/`M月D日 星期X`,吸顶),**细节点=日内 publishedAt 时段带**;竖轴贯穿;卡片标 publishedAt 时分。
- **constraints**:
  - **分组基准 = `publishedAt`**(不再用 `scoredAt ?? publishedAt`);**复用 `@fe-radar/shared` 的 `APP_TIMEZONE` 常量 + `dayjs`**(同 `meta.ts:1`,**禁硬编码 `'Asia/Shanghai'` 字符串**),`dayjs(item.publishedAt).tz(APP_TIMEZONE)`。**删除现有 `groupByDay` 的 `new Date().toISOString().slice(0,10)` UTC bug**。
  - **日期标题**:今天/昨天用相对语义(`dayjs().tz(APP_TIMEZONE)` 与条目同 TZ 比较 day),其余 `M月D日 星期X`;**日期头 `sticky`(硬要求)**:`top` 偏移必须**大于全局 header 高度**(桌面 `apps/web/components/layout/app-shell.tsx:156` `sticky top-0 z-10 ... py-2`;移动端同文件 :107 `z-30 py-2`,等高),并设合适 `z-index` 避免被遮挡或遮挡内容;须在带 header 的完整页面实测。若工程上确不可行,**回报主控改 spec,不得实现者自降级**。
  - **时段带**:按 publishedAt 小时分 4 段——`[0,6)` 凌晨 / `[6,12)` 上午 / `[12,18)` 下午 / `[18,24)` 晚间;每段显示条数(如「下午 · 14 条」)。空段不渲染。
  - **顺序**:日倒序、段倒序、段内沿用接口返回顺序(publishedAt desc, id desc)。分组只在已返回 items 上做(客户端),不改接口契约。
  - **竖轴 + 节点**:沿用现有 `before:` 竖线 + 节点圆点风格,粗/细节点视觉区分;卡片 `formatAppTime` 标 publishedAt 时分(`timeline-card.tsx:52` 现为 `scoredAt ?? publishedAt` → 改 **publishedAt**)。**说明**:TimelineCard 被 `/`、`/search`、`/items` 共用,故卡片时间统一显示 publishedAt(一致口径,不加 prop 分叉)。
  - **无障碍**:日期/时段节点有文字,不仅靠视觉;吸顶头不遮挡内容。
  - 保持 `variant="list"` 旧分支可用(其它页可能用);仅强化 `variant="timeline"`。
  - 「加载更多」分页行为不变(新页 items 并入后重新分组,跨页同日要能合并到同一日组——**注意**:增量加载时不要把同一天拆成两个日期头)。
- **ask_agent_first**:跨页加载时日/段分组的合并(避免第 2 页的"今天"又起一个新日期头——分组须在 `pages.flatMap` 后的全量 items 上做,`timeline-list.tsx:33-34` 已是此结构,保持);sticky `top` 偏移取值(须清掉 `app-shell.tsx` header 高度)。
- **owner**:标准 → GLM(`pi-executor`)→ 溢出 MiniMax。
- **scope**:`apps/web/components/timeline/timeline-list.tsx`、`apps/web/components/timeline/timeline-card.tsx`、**新建 `apps/web/components/timeline/timeline-grouping.ts`**(纯函数模块,无 JSX,便于单测——同 T-SRC-06 helpers 抽法)、`apps/web/components/timeline/__tests__/timeline-grouping.test.ts`;相关组件测试。**不**改 API/route/query。
- **helper 签名(已定,放 `timeline-grouping.ts`,全部 `export`)**:`getTimePeriod(d: Date|string): 'dawn'|'morning'|'afternoon'|'evening'`(按 publishedAt 小时 00/06/12/18 边界,内部 `dayjs().tz(APP_TIMEZONE)`);`getRelativeDayLabel(d, now?): string`(今天/昨天/`M月D日 星期X`);`groupTimeline(items): Array<{ dayKey; dayLabel; periods: Array<{ period; label; items }> }>`(在已 flatten 的全量 items 上分组,日倒序、段倒序)。`timeline-list.tsx` 仅消费这些纯函数 + 渲染。
- **rollback**:还原上述文件。
- **acceptance**:
  1. 日期分组按 Asia/Shanghai 正确(凌晨条目归属当日,不再错位);今天/昨天语义正确。
  2. 每个日组下出现非空时段带 + 条数;卡片显示 publishedAt 时分。
  3. 日期头吸顶(硬要求;`top` 清掉全局 header,不被遮挡)。
  4. 「加载更多」跨页:**同一 Asia/Shanghai 日期**的 items 不被拆成两个日期头(分组在合并后全量 items 上做);跨午夜产生**新**日期头是正确行为。
  5. `timeline-grouping.ts` 纯函数有 fixture 单测,**含跨午夜 TZ 边界**:`23:55` 与次日 `00:05` 分入不同日组;且**给定 mock `now` 时 today/yesterday 判定在跨午夜处正确**(如 now=次日 00:30 时,前一日 23:55 应判为"昨天"、当日 00:05 为"今天")。
  6. 现有筛选/详情弹窗/feedback 不回归;**`variant="list"` 扁平卡片流(不分组)与改动前一致**——`/items`、`/search` 走 list variant。**注**:本仓库无 DOM 测试基建(`@testing-library/react`/jsdom 未装、vitest node 环境、全 web 包无 `.test.tsx` 渲染测试),故渲染/快照断言不可行;以**结构性保证**替代——list 分支为 `items.map(TimelineCard)` 不调用 `groupTimeline`(代码审查确认)+ 单测断言 `groupTimeline` 不修改/不重排其输入数组(list 渲染的原始 items 不受分组重构影响)。
  7. typecheck 0 error;web 包 test 绿。

---

## 全局完成判据(Standard)

1. 主会话 + mimo 双双代码评审 APPROVE;
2. `pnpm -r typecheck` 0 error + `pnpm -r test` 全绿;
3. 每卡 acceptance 逐条满足;
4. 不变量无违反(TZ 用 dayjs().tz、可见性不动、curated 不动);
5. 产物标 `needs_human_review`。
