# MinIO 最小权限收权 Runbook（T-SEC-17）

## 背景

安全评审 Finding #17：canonical `deploy/stack.yml` 把 `minio_root_user/password` 同时挂给
web、worker、backup 三个长期服务。容器失陷即可控制全部 bucket 与备份。root 凭据应仅 MinIO
service 自己持有，长期服务改用 bucket/operation scoped service account。

本 runbook 给出零停机收权步骤。**不需要改代码**（MinIO client 读 env），只改部署 secret + env。

## 现状（核对代码确认每个服务实际调用的 S3 动作）

| 服务   | 代码位置                                                                                                               | 实际 S3 调用                                                    | 需要的权限（已收敛）                                                                          |
| ------ | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| web    | `apps/web/app/api/briefing/[id]/download/route.ts:104,114`                                                             | `statObject`（HEAD object，检查存在）+ `getObject`（下载 docx） | `s3:GetObject`（HEAD 与 GET object 都映射到此权限；web **不列 bucket**，故无需 `ListBucket`） |
| worker | `apps/worker/src/lib/briefing-render.ts:181,184`                                                                       | `bucketExists`（HEAD bucket）+ `putObject`（上传渲染后 docx）   | `s3:ListBucket`（HEAD bucket）+ `s3:PutObject`                                                |
| backup | 外部镜像 `fe-radar-backup`（`deploy/stack.yml` `backup` service，`MINIO_BUCKET=fe-radar-backups`、`RETENTION_DAYS=7`） | 上传备份 + 列举 + 按保留期删除旧备份                            | `s3:ListBucket` + `s3:GetObject` + `s3:PutObject` + `s3:DeleteObject`                         |

> **收敛点**：旧版 runbook 给 worker 多配了 `GetObject` / `DeleteObject`——代码只写不读不删，
> 已去掉。web 只 stat/get 具体对象、从不列 bucket，所以也**不含 `ListBucket`**。
>
> **worker 的 `makeBucket` 是 bootstrap 便利逻辑，不是权限需求**：`briefing-render.ts:181-183`
> 先 `bucketExists` 为 false 才 `makeBucket`。在最小权限下 worker **没有 `s3:CreateBucket`**，
> 故 bucket **必须由 root 预先创建**（见步骤 0）。正常生产 bucket 已存在 → `bucketExists` 返回
> true → `makeBucket` 跳过；若 bucket 不存在，`makeBucket` 会 AccessDenied 失败（正确行为：
> 强制运维建桶，而非让 worker 持建桶权限）。

## 收权步骤

> 前置：`mc` 已配置好指向 MinIO 的 alias（下文用 `local`），且当前会话持有 root 凭据。
> `mc admin policy` 的正确顺序是 **先 `create` 再 `attach`**，二者是不同子命令（见文末命令参考）。

### 0. 用 root 预先创建两个 bucket（worker 无 CreateBucket 权限）

```bash
# --ignore-existing：桶已存在时不报错、退出码 0（生产重跑 / set -e 安全）
mc mb --ignore-existing local/fe-radar-briefings
mc mb --ignore-existing local/fe-radar-backups
# 确保无匿名访问（与收权目的矛盾；set 本身幂等）
mc anonymous set none local/fe-radar-briefings
mc anonymous set none local/fe-radar-backups
```

### 1. 用 root 创建三个 scoped service account

> **重跑注意**：`mc admin user add` 在用户已存在时会非零退出（无官方 ignore 旗标）。
> 中途失败后从头再来时，先 `mc admin user info local <ACCESS_KEY>` 查是否已存在：
> 已存在则**跳过 add**（若需换密用 `mc admin user svcacct` / 轮换 secret，勿盲目重 add）。

```bash
# web 只读账号（下载简报 docx）
mc admin user add local fe-radar-web-ro <生成强随机密码>

# worker 写账号（仅 briefings bucket，检查 bucket + 上传）
mc admin user add local fe-radar-worker-briefings <生成强随机密码>

# backup 备份账号（仅 backups bucket，含保留期删除）
mc admin user add local fe-radar-backup <生成强随机密码>
```

### 2. 创建三份精确的 policy JSON 并 `mc admin policy create`

⚠️ **必须先 create 再 attach**——policy 不存在时 `attach` 直接失败。
把下方三份 JSON 存成本地文件，然后：

> **重跑注意**：`mc admin policy create` 在同名 policy 已存在时通常非零退出。
> 重跑时先 `mc admin policy info local <POLICY_NAME>`：已存在且内容正确则跳过 create；
> 若 JSON 有改动，需先 `mc admin policy remove local <POLICY_NAME>` 再 create
> （remove 前确认无生产流量依赖该 policy，或先 attach 新名再切）。

```bash
mc admin policy create local fe-radar-briefings-readonly /tmp/web-ro.json
mc admin policy create local fe-radar-briefings-writer  /tmp/worker-briefings.json
mc admin policy create local fe-radar-backups-rw        /tmp/backup-rw.json

# 查验
mc admin policy list local
mc admin policy info local fe-radar-briefings-readonly
```

> **ARN 写法**：bucket 本身（`arn:aws:s3:::bucket`）与 bucket 内对象（`arn:aws:s3:::bucket/*`）
> 是**两条不同的 ARN**；`ListBucket` 作用在前者，`GetObject/PutObject/DeleteObject` 作用在后者。
> 写反会导致"能列不能传"或反之。每份 policy 末尾的 `Deny + NotResource` 是**显式跨 bucket 隔离**
> （defense-in-depth：即使日后误挂其它 bucket，该账号也无法访问本 bucket 之外任何资源）。

#### `/tmp/web-ro.json` — web 只读（`fe-radar-briefings-readonly`）

仅 `s3:GetObject`（statObject + getObject），无 ListBucket、无 PutObject。

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject"],
      "Resource": ["arn:aws:s3:::fe-radar-briefings/*"]
    },
    {
      "Effect": "Deny",
      "Action": ["s3:*"],
      "NotResource": [
        "arn:aws:s3:::fe-radar-briefings",
        "arn:aws:s3:::fe-radar-briefings/*"
      ]
    }
  ]
}
```

#### `/tmp/worker-briefings.json` — worker 写（`fe-radar-briefings-writer`）

仅 `s3:ListBucket`（bucketExists HEAD bucket）+ `s3:PutObject`（上传 docx）。
**不含 `GetObject`、`DeleteObject`**——worker 只写不读不删。

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:ListBucket"],
      "Resource": ["arn:aws:s3:::fe-radar-briefings"]
    },
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject"],
      "Resource": ["arn:aws:s3:::fe-radar-briefings/*"]
    },
    {
      "Effect": "Deny",
      "Action": ["s3:*"],
      "NotResource": [
        "arn:aws:s3:::fe-radar-briefings",
        "arn:aws:s3:::fe-radar-briefings/*"
      ]
    }
  ]
}
```

#### `/tmp/backup-rw.json` — backup 读写删（`fe-radar-backups-rw`）

仅 `fe-radar-backups` bucket 的 ListBucket + Get/Put/Delete object（保留期清理需要 Delete）。

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:ListBucket"],
      "Resource": ["arn:aws:s3:::fe-radar-backups"]
    },
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
      "Resource": ["arn:aws:s3:::fe-radar-backups/*"]
    },
    {
      "Effect": "Deny",
      "Action": ["s3:*"],
      "NotResource": [
        "arn:aws:s3:::fe-radar-backups",
        "arn:aws:s3:::fe-radar-backups/*"
      ]
    }
  ]
}
```

### 3. attach policy 到用户

> **重跑注意**：`mc admin policy attach` 在用户**已绑定**该 policy 时也会非零退出
> （mc 社区 issue #4863；无官方 ignore 旗标）。重跑前用 `mc admin user info` 看
> 已绑定 policy 列表：已正确绑定则跳过 attach。

```bash
mc admin policy attach local fe-radar-briefings-readonly --user fe-radar-web-ro
mc admin policy attach local fe-radar-briefings-writer  --user fe-radar-worker-briefings
mc admin policy attach local fe-radar-backups-rw        --user fe-radar-backup

# 查验用户绑定
mc admin user info local fe-radar-web-ro
mc admin user info local fe-radar-worker-briefings
mc admin user info local fe-radar-backup
```

### 4. 在 Portainer 新建对应 secrets

`minio_web_access_key` / `minio_web_secret_key` → `fe-radar-web-ro` + 密码。
`minio_worker_access_key` / `minio_worker_secret_key` → `fe-radar-worker-briefings` + 密码。
`minio_backup_access_key` / `minio_backup_secret_key` → `fe-radar-backup` + 密码。
另需 `minio_root_user` / `minio_root_password`（MinIO service 自己持有）。

### 5. stack.yml 已落地 scoped secret（供核对，无需再改）

canonical `deploy/stack.yml` 已为 web/worker 切到 scoped secret，root 仅 MinIO service 持有：

```yaml
# web service
MINIO_ACCESS_KEY_FILE: /run/secrets/minio_web_access_key
MINIO_SECRET_KEY_FILE: /run/secrets/minio_web_secret_key
secrets: [ minio_web_access_key, minio_web_secret_key, ... ]

# worker service
MINIO_ACCESS_KEY_FILE: /run/secrets/minio_worker_access_key
MINIO_SECRET_KEY_FILE: /run/secrets/minio_worker_secret_key
secrets: [ minio_worker_access_key, minio_worker_secret_key, ... ]
```

> **部署前置（评审 ops gate）**：stack.yml 以 `:?` 强制 6 个 external secret（web/worker/backup 各一对）
>
> - `NEXTAUTH_URL`（生产必须 https origin）+ 显式 `IMAGE_TAG`（禁 latest）。**必须先建齐 secret
>   再更新 stack**，否则 Portainer 更新直接失败。

### 6. 部署 + 验证（正向）

- `docker stack deploy` 滚动更新。
- 验证 web 下载简报仍 200（`statObject` + `getObject` 走通）。
- 验证 worker 渲染上传仍成功（`bucketExists` + `putObject` 走通）。
- 验证 root secret 不再出现在 web/worker 容器 `/run/secrets/`（只剩 minio*web*_ / minio*worker*_）。

### 7. 负向验证（最小权限是否真的生效）

用 scoped 账号配临时 alias，逐一验证**越权操作被拒**：

```bash
# —— worker 账号 ——
mc alias set test-worker http://minio:9000 fe-radar-worker-briefings <密码>

# 正向：能上传（PutObject）
echo ok > /tmp/probe.txt
mc cp /tmp/probe.txt test-worker/fe-radar-briefings/probe.txt   # 期望成功

# 负向：worker 不能读（无 GetObject）→ AccessDenied
mc cat test-worker/fe-radar-briefings/probe.txt

# 负向：worker 不能删（无 DeleteObject）→ AccessDenied
mc rm test-worker/fe-radar-briefings/probe.txt

# 负向：跨 bucket（NotResource Deny）→ AccessDenied
mc ls test-worker/fe-radar-backups/

# —— web 账号 ——
mc alias set test-web http://minio:9000 fe-radar-web-ro <密码>

# 正向：能下载已存在的简报（GetObject）
mc cat test-web/fe-radar-briefings/<某已存在 docx key>           # 期望成功

# 负向：web 不能写（无 PutObject）→ AccessDenied
mc cp /tmp/probe.txt test-web/fe-radar-briefings/x.txt

# 负向：web 不能列（无 ListBucket）→ AccessDenied
mc ls test-web/fe-radar-briefings/

# 负向：跨 bucket → AccessDenied
mc ls test-web/fe-radar-backups/
```

任一"应失败"操作成功 → policy 过宽，回滚 stack 并重检 policy JSON。

### 8. 轮换 root（可选但建议）

收权完成后轮换 `minio_root_user/password`，并更新 MinIO service 的 secret。

## 命令参考（mc admin policy）

```bash
# 1) 用 JSON 文件创建具名 policy（policy 不存在时 attach 会失败）
mc admin policy create <ALIAS> <POLICY_NAME> /path/to/policy.json

# 2) 把已存在的 policy 绑到用户（或 group）
mc admin policy attach <ALIAS> <POLICY_NAME> --user <ACCESS_KEY>
mc admin policy attach <ALIAS> <POLICY_NAME> --group <GROUP>

# 查验
mc admin policy list <ALIAS>
mc admin policy info <ALIAS> <POLICY_NAME>
mc admin user info <ALIAS> <ACCESS_KEY>
```

> 注：旧版 `mc admin policy set <ALIAS> <POLICY> user=<USER>` 在新版 mc 已废弃，且它**不创建
> policy**（旧 runbook 只 `attach`/`set` 三个 policy 却从未 create，干净 MinIO 上照抄必失败）。
> 正确顺序是 `create`（建 policy）→ `attach`（绑用户）。

## 回滚

把 web/worker 的 `MINIO_*_FILE` env 改回 `minio_root_user/password` 并重新挂 root secret。
（不推荐长期回滚：等于撤销收权。）
