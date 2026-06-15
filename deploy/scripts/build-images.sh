#!/usr/bin/env bash
# FE-Radar 镜像一键构建 + 推送到内网 Harbor。
#
# 在仓库根目录、有 Docker 的构建机上运行（Dockerfile 的 COPY 以仓库根为 build context）。
#
# 用法：
#   deploy/scripts/build-images.sh --prepare      # 先预拉基础镜像，再构建应用镜像
#   deploy/scripts/build-images.sh --push         # 构建并 docker push 到 Harbor
#   deploy/scripts/build-images.sh worker --push  # 只构建+推 worker 一个（逐个来、错误当场停）
#   REGISTRY=harborssl.fegroup.cn/custom-project deploy/scripts/build-images.sh --push
#
# 可选镜像名（位置参数，子串匹配）：worker / migrate / web / backup
set -euo pipefail

REGISTRY="${REGISTRY:-harborssl.fegroup.cn/custom-project}"
NODE_SLIM_IMAGE="${NODE_SLIM_IMAGE:-fe-radar-build-node:22-slim-pnpm11}"
NODE_WEB_IMAGE="${NODE_WEB_IMAGE:-fe-radar-build-node:22-slim-pnpm11}"
NODE_SLIM_BASE_IMAGE="${NODE_SLIM_BASE_IMAGE:-docker.m.daocloud.io/library/node:22-slim}"
ALPINE_IMAGE="${ALPINE_IMAGE:-docker.m.daocloud.io/library/alpine:3.22}"
PGVECTOR_IMAGE="${PGVECTOR_IMAGE:-docker.m.daocloud.io/pgvector/pgvector:pg16}"
NPM_REGISTRY="${NPM_REGISTRY:-https://registry.npmmirror.com}"
DEBIAN_MIRROR="${DEBIAN_MIRROR:-https://mirrors.aliyun.com/debian}"
DEBIAN_SECURITY_MIRROR="${DEBIAN_SECURITY_MIRROR:-https://mirrors.aliyun.com/debian-security}"
ALPINE_MIRROR="${ALPINE_MIRROR:-https://mirrors.aliyun.com/alpine}"
PLAYWRIGHT_DOWNLOAD_HOST="${PLAYWRIGHT_DOWNLOAD_HOST:-https://npmmirror.com/mirrors/playwright}"
MINIO_MC_URL="${MINIO_MC_URL:-https://dl.min.io/client/mc/release/linux-amd64/mc}"
PUSH=0; MIRROR=0; WITH_BACKUP=0; PREPARE=0; ONLY=""
for arg in "$@"; do
  case "$arg" in
    --push) PUSH=1 ;;
    --mirror) MIRROR=1 ;;
    --prepare) PREPARE=1 ;;
    --with-backup) WITH_BACKUP=1 ;;
    -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    --*) echo "unknown flag: $arg" >&2; exit 2 ;;
    *) ONLY="$ONLY $arg"; [ "$arg" = "backup" ] && WITH_BACKUP=1 ;;  # 指定镜像名
  esac
done

# 切到仓库根目录（脚本在 deploy/scripts/ 下）
cd "$(dirname "$0")/../.."
echo "repo root: $(pwd)"
echo "registry : $REGISTRY   push=$PUSH mirror=$MIRROR prepare=$PREPARE"
echo "npm      : $NPM_REGISTRY"
echo "debian   : $DEBIAN_MIRROR"
echo "alpine   : $ALPINE_MIRROR"

if [ "$PREPARE" = "1" ]; then
  echo "==> pre-pull base images"
  docker pull "$NODE_SLIM_BASE_IMAGE"
  docker pull "$ALPINE_IMAGE"
  docker pull "$PGVECTOR_IMAGE"
fi

BUILD_ARGS=(
  --build-arg "NODE_SLIM_IMAGE=$NODE_SLIM_IMAGE"
  --build-arg "NODE_WEB_IMAGE=$NODE_WEB_IMAGE"
  --build-arg "ALPINE_IMAGE=$ALPINE_IMAGE"
  --build-arg "PGVECTOR_IMAGE=$PGVECTOR_IMAGE"
  --build-arg "NPM_REGISTRY=$NPM_REGISTRY"
  --build-arg "DEBIAN_MIRROR=$DEBIAN_MIRROR"
  --build-arg "DEBIAN_SECURITY_MIRROR=$DEBIAN_SECURITY_MIRROR"
  --build-arg "ALPINE_MIRROR=$ALPINE_MIRROR"
  --build-arg "PLAYWRIGHT_DOWNLOAD_HOST=$PLAYWRIGHT_DOWNLOAD_HOST"
  --build-arg "MINIO_MC_URL=$MINIO_MC_URL"
)

# 镜像清单： "<Dockerfile> <repo:tag>"
IMAGES=(
  "deploy/Dockerfile.worker            fe-radar-worker:latest"
  "deploy/Dockerfile.migrate           fe-radar-migrate:latest"
  "deploy/Dockerfile.web               fe-radar-web:latest"
)
[ "$WITH_BACKUP" = "1" ] && IMAGES+=("deploy/Dockerfile.backup fe-radar-backup:latest")

built=0
for entry in "${IMAGES[@]}"; do
  dockerfile="${entry%% *}"
  repo="${entry##* }"
  # 短名（用于 ONLY 子串匹配）：fe-radar/postgres-zhparser:pg16 → postgres-zhparser
  short="${repo##*/}"; short="${short%%:*}"
  if [ -n "$ONLY" ]; then
    match=0
    for tok in $ONLY; do case "$short" in *"$tok"*) match=1 ;; esac; done
    [ "$match" = "1" ] || continue
  fi
  tag="$REGISTRY/$repo"
  echo "==> build $tag  (-f $dockerfile)"
  docker build "${BUILD_ARGS[@]}" -f "$dockerfile" -t "$tag" .
  if [ "$PUSH" = "1" ]; then
    echo "==> push  $tag"
    docker push "$tag"
  fi
  built=$((built + 1))
done
[ -n "$ONLY" ] && [ "$built" = "0" ] && { echo "没有镜像匹配:${ONLY} (可选 postgres/worker/migrate/web/backup)" >&2; exit 2; }

# 公共镜像同步（内网拉不到 Docker Hub 时需要）。leaf 名/标签按你 Harbor 实际约定，自行调整。
if [ "$MIRROR" = "1" ]; then
  RSSHUB_DIGEST="diygod/rsshub@sha256:0d40e1c9e5c3811da2c4eeaf7443e1bcdc6d7dc5510aa3df98bab0f979c03059"
  echo "==> mirror redis:7-alpine"
  docker pull redis:7-alpine
  docker tag  redis:7-alpine "$REGISTRY/redis:7-alpine"
  echo "==> mirror rsshub (pinned)"
  docker pull "$RSSHUB_DIGEST"
  docker tag  "$RSSHUB_DIGEST" "$REGISTRY/diygod/rsshub:pinned"
  if [ "$PUSH" = "1" ]; then
    docker push "$REGISTRY/redis:7-alpine"
    docker push "$REGISTRY/diygod/rsshub:pinned"
    echo "注意：若用 rsshub:pinned 标签，请把 compose/stack 里 rsshub 的 @sha256 改成 :pinned"
  fi
fi

echo "done."
