# T-REV-03 PBOC `fx_usdcny` 源核实记录

**日期**：2026-07-09  
**环境**：Cursor 实现机（非部署内网）  
**结论**：**不启用**（合法产出；不强行开源）

## 试抓结果

| URL                                                                    | 结果                                                   |
| ---------------------------------------------------------------------- | ------------------------------------------------------ |
| `http://www.pbc.gov.cn/rmyh/108976/109428/index.html`（seed endpoint） | `curl: (52) Empty reply from server`，HTTP 000，size=0 |
| `https://www.pbc.gov.cn/rmyh/108976/index.html`（adapter DEFAULT）     | `SSL_ERROR_SYSCALL`，HTTP 000                          |
| `https://www.pbc.gov.cn/` / `http://www.pbc.gov.cn/`                   | 同上，根站亦不可达                                     |
| 对照：`chinamoney.com.cn` / `safe.gov.cn` 汇率页                       | 本机同样 SSL/空响应失败                                |

未拿到任何 HTML，**无法验证** `pboc.ts` 解析器对线上 DOM 是否仍有效。

## 本地代码侧

- `apps/worker/src/fetchers/quotes/__tests__/pboc.test.ts` + fixture `pboc-ok.html`：**解析逻辑单测通过**（能从 fixture 抽出 `fx_usdcny≈7.2345`）。
- seed（`0009_commodity_seed.sql`）该源默认 `enabled=false`，与「部署网可达前保持禁用」的历史惯例一致（参见 0014 对 `.gov.cn` 的 verify 注释）。

## 决策

按任务卡约束：**不强行启用会持续失败并推入 `fail_count>=7` 自动禁用循环的源**。

- **不新增** `002X_enable_pboc_source.sql`。
- 下一步需在**部署内网 / 代理池通电后**再做一次 smoke：若能返回含「美元」行的表格 HTML 且解析出非 null `value`，再开新迁移启用。
- 若部署网可达但 DOM 已变导致 `value=null`，再拆卡改造 `pboc.ts`（超出本卡「低成本核实」范围，需主会话确认）。

## Rollback

无迁移落地，无需 rollback。
