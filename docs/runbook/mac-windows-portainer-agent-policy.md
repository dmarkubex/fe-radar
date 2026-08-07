# Mac / Windows / Portainer — Agent 默认策略

> 适用：本机 Mac 开发 + Windows 构建机 `diaomin@10.106.29.220` + Portainer `https://10.1.20.156:9443`（stack `fe-radar`）。  
> 目标：分工清楚、可复现、少误伤生产。

## 1. 三角色（不要混）

| 角色                                        | 位置                                               | 职责                                                                      |
| ------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------- |
| **Mac 总控 Agent**（Grok / Claude / Codex） | Mac                                                | 理解意图、跨端编排、改业务代码、Portainer 查询/受控部署、写脚本与 runbook |
| **Windows 驻场 Kimi**                       | Windows `C:\Users\diaomin\.kimi-code\bin\kimi.exe` | 只解决 **Windows 本机** 环境/路径/Docker 桌面/凭据/本机日志等不确定问题   |
| **固定脚本**                                | Mac 调 SSH / 或 Windows 仓内脚本                   | 已验证步骤：`git pull`、镜像 build/push、Portainer 状态检查               |

**原则**：确定性步骤走脚本；不确定性本机问题派 Windows Kimi；跨端决策与发版策略由 Mac 总控 + 人确认。

## 2. 默认升级阶梯（按顺序，不跳级）

```text
L0  已知 SOP / 脚本
    └─ 直接执行（可 dry-run 时先 dry-run）

L1  Mac 总控 + SSH 快查
    └─ 少量只读命令：docker version、git status、dir、Portainer status
    └─ 能定位则给出修复命令或补脚本；仍不确定 → L2

L2  Windows 驻场 Kimi（ssh + kimi -p）
    └─ 工作目录固定到目标仓（默认 FE-Radar：C:\Users\diaomin\project\fe-radar）
    └─ 诊断默认不加 --auto；需要本机改配置时再用 --auto，且范围写死在 prompt 里

L3  人确认后的写操作
    └─ 推 Harbor、更新 Portainer stack、改生产 env/secret、删数据/强制重启关键服务
```

**禁止**：一上来就 Windows Kimi `--auto` 全盘修；禁止用 Kimi 临场发挥替代发版 SOP。

## 3. 场景对照表

| 场景                                                        | 默认执行方                                                  | 权限                            |
| ----------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------- |
| 问「能不能发版 / 链路是否通」                               | Mac 总控 + L1 快查                                          | 只读                            |
| `git` 警告、PATH、盘符、Docker Desktop 管道、本机服务起不来 | L1 → 不够再 L2 Kimi                                         | 诊断只读；改本机配置需写明范围  |
| `git pull` / `build-images.sh --push`                       | **脚本 + SSH**（不用 Kimi 主路径）                          | 构建机写；推镜像前确认 tag/范围 |
| Portainer 状态 / 容器是否 Up                                | Mac：`scripts/portainer-status.sh` 或 Codex Portainer skill | 只读                            |
| Portainer 更新 stack / 拉新镜像                             | Mac Portainer API + skill；**先 dry-run**                   | 必须人确认                      |
| 业务代码实现/评审                                           | Mac 仓内流程（与本策略无关）                                | 按项目 kernel                   |
| migrate one-shot / 生产 DB                                  | 人确认 + 既有 runbook                                       | 禁止 agent 自行决定             |

## 4. Windows Kimi 调用约定

### 4.1 默认命令形态

```bash
# 诊断（默认）
ssh diaomin@10.106.29.220 \
  "cd /d C:\Users\diaomin\project\fe-radar && C:\Users\diaomin\.kimi-code\bin\kimi.exe -p \"<只读诊断任务，不要改生产、不要 docker push>\""

# 本机修复（仅 L2 且范围明确时）
ssh diaomin@10.106.29.220 \
  "cd /d C:\Users\diaomin\project\fe-radar && C:\Users\diaomin\.kimi-code\bin\kimi.exe --auto -p \"<范围：仅 Windows 本机 XXX；禁止 push Harbor；禁止改 Portainer>\""
```

### 4.2 Prompt 必须带的边界（复制即用）

- 工作目录：`C:\Users\diaomin\project\fe-radar`（除非任务明确指向其他仓）
- **允许**：查 Docker/Git/磁盘/PATH、改本机 git config、启动/检查 Docker Desktop 相关状态、本机日志
- **禁止**：`docker push` 到 Harbor（除非人已明确授权本轮推送）、调用 Portainer API、改生产 stack env/secret、删除数据卷、force push git
- 结束时输出：结论 / 已做变更 / 未做事项 / 建议的下一条脚本命令

### 4.3 与 Mac 总控的关系

- Mac 总控负责：**要不要派 Kimi、prompt 边界、解读结果、是否升到 L3**
- Windows Kimi **不**负责：产品决策、是否上线、和 Mac 未提交 diff 对齐
- **同一目录禁止** Mac agent 与 Windows Kimi 并行写文件

## 5. 发版主路径（永不改成「聊出来的」）

默认顺序：

1. Mac：代码已 commit/push 到构建机可见的 remote（内网 GitLab `fe-radar`）
2. Windows（SSH 脚本，非 Kimi）：
   - `git pull --ff-only`
   - `deploy/scripts/build-images.sh`（按需 web/worker/migrate… + `--push`）
3. Mac：Portainer 更新 stack（`PullImage=true`）— **先 dry-run，人确认再真更新**
4. 既有阻塞门：migrate / 健康检查 / 日志（见 `docs/runbook/deploy-portainer.md`）
5. 失败：Mac 总控先 L1 读 Portainer logs；像是构建机环境再 L2 Kimi

凭据：

- Portainer / Harbor 密码：只存在本机 skill 私有 `.env`（如 `~/.codex/skills/harbor-portainer-stack-deploy/.env`），**不进仓库**
- Windows git：用户级 `credential.helper=store` → `C:/Users/diaomin/.git-credentials`（已规避 SSH 下 wincredman 警告）

## 6. 连接事实（现状快照）

| 资源              | 值                                                                        |
| ----------------- | ------------------------------------------------------------------------- |
| Windows SSH       | `diaomin@10.106.29.220`                                                   |
| FE-Radar 构建目录 | `C:\Users\diaomin\project\fe-radar`                                       |
| 内网 Git          | `http://10.1.72.33/workflow/fe-radar.git`                                 |
| Harbor            | `harborssl.fegroup.cn/custom-project`                                     |
| Portainer         | `https://10.1.20.156:9443`，endpoint `local` id=3，stack `fe-radar` id=89 |
| 模式              | Compose stack（非 Swarm services）                                        |
| 只读巡检          | 仓库内 `scripts/portainer-status.sh`                                      |

Docker Desktop 必须在 Windows 上运行；建议开启登录时自启。IP 若 DHCP 变更，以 Windows `ipconfig` 为准并更新本文件本节。

## 7. 人确认门槛（默认要问）

以下 **默认不得自动执行**，须用户明确授权当次操作：

- `docker push` / 覆盖生产使用的 `latest`（或约定 tag）
- Portainer stack update / 重启核心服务（web/worker/postgres）
- 修改 stack 环境变量或 secret
- 生产库 migrate 以外的手工 SQL
- Windows 上删除磁盘镜像/卷、重置 Docker

可默认自动（只读或可逆）：

- SSH 探测、`git fetch`/`status`、`docker version`/`images`
- Portainer 列表与日志只读
- dry-run 部署计划
- 诊断向 Windows Kimi `-p`（无 `--auto`）

## 8. 一句话默认策略

**Mac 总控编排；Windows 脚本构建；Portainer 受控发布；Windows Kimi 只打本机环境补丁；生产写操作先问人。**
