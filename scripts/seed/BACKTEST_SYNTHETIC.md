# Backtest synthetic 样本说明（KYO-54）

## 状态

- **产物**: `scripts/samples/scoring-backtest.synthetic.json`（500 条）
- **生成**: `pnpm exec tsx scripts/seed/generate-backtest-samples.ts`（seed=`54002`）
- **用途**: 阻塞兜底 / `scoring-backtest.ts` 脚本校验

## 真实/历史样本不可取的原因

1. **Phase 2 未执行**：build server 尚未完成 docker compose + 采集一轮，无法从生产/候选池导出 ≥500 条已评分历史 items。
2. **Phase 1-B 标注未开始**：prefilter / NER / scorer 人工标注依赖真实采集样本，当前无 ground-truth 可转 backtest expected。
3. **生产库访问不可用**：release 期本地 workspace 无 DATABASE_URL 指向含历史评分的生产快照。

## 限制（Reviewer 拍板）

- 本 synthetic 集 **不能** 标记「真实 backtest 已完成」
- **不能** 替代 Phase 1-B / release smoke 的 Pearson gate
- Phase 2 采集 + Phase 1-B 人工标注完成后，应替换为 `scripts/samples/scoring-backtest.historical.json`（新 issue）
