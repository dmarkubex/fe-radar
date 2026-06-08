#!/usr/bin/env bash
# FE-Radar 部署后 fetch 自检：一条命令输出
#   1) 各类型 enabled 信源数
#   2) 各类型实际抓到的条目数 + 命中源数 + 最近抓取时间（items.fetched_at）
#   3) 失败源清单（fail_count / last_error）
#   4) zhparser 是否生效
#   5) RSSHub 健康提示
#
# 默认对 deploy/compose.fetch-smoke.yml 的 postgres 服务执行 psql。
# 用法：
#   deploy/scripts/fetch-smoke-check.sh
#   # 自定义连接方式（如 Swarm stack / 指定容器）：
#   PSQL_CMD='docker exec -i <pg容器> psql -U fe_radar -d fe_radar' deploy/scripts/fetch-smoke-check.sh
#   COMPOSE_FILE=deploy/compose.fetch-smoke.yml deploy/scripts/fetch-smoke-check.sh
set -u

cd "$(dirname "$0")/../.." 2>/dev/null || true

COMPOSE_FILE="${COMPOSE_FILE:-deploy/compose.fetch-smoke.yml}"
PSQL_CMD="${PSQL_CMD:-docker compose -f $COMPOSE_FILE exec -T postgres psql -U fe_radar -d fe_radar}"
WORKER_EXEC="${WORKER_EXEC:-docker compose -f $COMPOSE_FILE exec -T worker}"

runsql() { $PSQL_CMD -v ON_ERROR_STOP=0 -P pager=off -c "$1"; }

echo "########################################################################"
echo "# FE-Radar fetch 自检  (psql: $PSQL_CMD)"
echo "########################################################################"

echo
echo "== 1. 各类型 enabled 信源数 =========================================="
runsql "SELECT fetcher_type,
               count(*) FILTER (WHERE enabled) AS enabled,
               count(*)                         AS total
        FROM sources GROUP BY 1 ORDER BY 1;"

echo
echo "== 2. 各类型实际抓取结果（items.fetched_at 为抓取时间）==============="
runsql "SELECT s.fetcher_type,
               count(i.id)                  AS items,
               count(DISTINCT i.source_id)  AS sources_hit,
               max(i.fetched_at)            AS last_fetch
        FROM sources s LEFT JOIN items i ON i.source_id = s.id
        GROUP BY 1 ORDER BY items DESC;"

echo
echo "== 3. 失败源清单（fail_count>0 或有 last_error）======================"
runsql "SELECT fetcher_type, name, fail_count, last_error_at,
               left(last_error, 80) AS error
        FROM sources
        WHERE enabled AND (fail_count > 0 OR last_error IS NOT NULL)
        ORDER BY fail_count DESC, last_error_at DESC NULLS LAST
        LIMIT 40;"

echo
echo "== 4. 总览 + zhparser 健康 ==========================================="
runsql "SELECT (SELECT count(*) FROM items)                         AS total_items,
               (SELECT count(*) FROM sources WHERE enabled)         AS enabled_sources,
               (to_tsvector('zhparser','电力电缆储能') IS NOT NULL)  AS zhparser_ok;"

echo
echo "== 5. RSSHub 健康（rss / quotes 源依赖）=============================="
if $WORKER_EXEC sh -c 'command -v curl >/dev/null 2>&1'; then
  $WORKER_EXEC sh -c 'curl -fsS http://rsshub:1200/healthz || echo "RSSHUB 不健康/不可达"'
else
  echo "worker 容器内无 curl；请改用：docker compose -f $COMPOSE_FILE ps rsshub  （看 healthy 状态）"
fi

echo
echo "判据：第 2 节某类型 items>0 即该类型抓取链路通；第 3 节是需要排查的源"
echo "（政府 html 多半因未配代理池被封，属预期）。quotes 默认 disabled，不在本轮。"
