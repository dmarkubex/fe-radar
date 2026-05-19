#!/usr/bin/env bash
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo "${CYAN}[dev-setup]${NC} $1"; }
ok()   { echo "${GREEN}[OK]${NC} $1"; }
warn() { echo "${YELLOW}[WARN]${NC} $1"; }
fail() { echo "${RED}[FAIL]${NC} $1"; exit 1; }

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

DC="docker compose"
if ! docker compose version &>/dev/null; then
  DC="docker-compose"
  if ! command -v docker-compose &>/dev/null; then
    fail "docker compose / docker-compose not found. Install Docker Desktop or Colima first."
  fi
fi

# ── 0. Check Docker daemon ──
if ! docker info &>/dev/null; then
  warn "Docker daemon not running."
  if command -v colima &>/dev/null; then
    log "Starting Colima..."
    colima start --cpu 2 --memory 4 --disk 20
  else
    fail "Start Docker or Colima manually, then re-run this script."
  fi
fi

# ── 1. Start infra ──
log "Starting PostgreSQL + Redis..."
$DC -f docker-compose.dev.yml up -d

log "Waiting for Postgres..."
for i in $(seq 1 30); do
  if $DC -f docker-compose.dev.yml exec -T postgres pg_isready -U fe_radar &>/dev/null; then
    break
  fi
  sleep 1
done
ok "Postgres ready"

# ── 2. Run migrations (e2e mode: skip zhparser) ──
log "Running migrations (e2e mode)..."
export DATABASE_URL="postgres://fe_radar:fe_radar_dev@localhost:5432/fe_radar"
export MIGRATION_PROFILE="e2e"
pnpm --filter @fe-radar/db migrate
ok "Migrations applied"

# ── 3. Seed admin user ──
log "Seeding admin user..."
SEED_ADMIN_USERNAME=admin \
SEED_ADMIN_PASSWORD=admin123 \
SEED_ADMIN_NAME=刁敏 \
SEED_ADMIN_DEPT=战略部 \
pnpm --filter @fe-radar/db seed:admin
ok "Admin user seeded (admin / admin123)"

# ── 4. Seed mock data ──
log "Seeding mock data (15 items + 1 daily report)..."
pnpm --filter @fe-radar/db seed:mock
ok "Mock data seeded"

# ── 5. Start dev servers ──
echo ""
ok "==========================================="
ok "  ALL READY — 测试环境已就绪"
ok "==========================================="
echo ""
echo "  ${GREEN}登录:${NC}     http://localhost:3000/auth/login"
echo "  ${GREEN}账号:${NC}     admin / admin123"
echo ""
echo "  页面清单:"
echo "    /                       时间线"
echo "    /admin/dashboard        概览仪表盘"
echo "    /curated                精选"
echo "    /alerts                 告警"
echo "    /daily                  日报"
echo "    /items/1                条目详情"
echo "    /admin/sources          信源管理"
echo "    /admin/scoring-config   评分配置"
echo ""
echo "  ${YELLOW}Ctrl+C 停止${NC}"
echo ""

pnpm --filter @fe-radar/worker dev &
sleep 2
pnpm --filter @fe-radar/web dev
