# 钉钉群卡片内免登需求

状态：Implemented（待生产配置与真机验收）

日期：2026-08-06

## 目标

用户从钉钉群 ActionCard 点击 FE-Radar 日报或铜锂简报深链时，如果当前没有 FE-Radar 会话，应在钉钉客户端内自动取得企业身份、签发既有 Auth.js 会话并返回原页面，不再要求扫码。

## 功能需求

- FR-01：已有有效 `fe-radar.session-token` 时，深链行为不变，直接打开目标页面。
- FR-02：无会话且请求来自钉钉客户端时，受保护页面自动进入钉钉内免登流程；必须保留 pathname 与 query，例如 `/daily?date=2026-08-06`。
- FR-03：前端通过钉钉 H5 JSAPI `runtime.permission.requestAuthCode` 获取一次性免登码；免登码只提交给本站 Auth.js provider。
- FR-04：服务端以企业内部应用 AppKey/AppSecret 换取应用 access token，再用免登码换 userId、读取用户详情，最终只使用 `unionid`、`name`、`dept`（当前与扫码 Provider 一致可为 null），不得读取或存储手机号。
- FR-05：免登用户必须继续经 `mergeOrCreateUser()`，复用现有角色、停用和账号合并规则；不得另建会话体系。
- FR-05a：`dingtalk_id` 已存在但 `disabled_at` 非空时，扫码登录与钉钉内免登都必须拒绝；不得因新增入口绕过停用状态。
- FR-06：Auth.js 继续签发现有 httpOnly JWT Cookie（2 小时、滑动续期）；卡片 URL、浏览器 URL 和日志中不得出现 access token、AppSecret、unionid 或用户资料。
- FR-07：钉钉外部浏览器、钉钉 JSAPI 不可用或免登失败时，显示明确错误并允许回到现有二维码登录；不得形成重定向循环。
- FR-08：现有钉钉扫码登录、应急本地登录和 RBAC 行为保持不变。

## 非功能需求

- NFR-01：`callbackUrl` 只允许本站相对路径，拒绝协议相对 URL、绝对外域 URL 和控制字符。
- NFR-02：所有钉钉 HTTP 调用必须有超时、HTTP/业务错误检查；错误信息不得包含凭据或免登码。
- NFR-03：应用 access token 在进程内按过期时间缓存，避免每个用户登录都重复取 token；多 web 副本各自缓存可接受。
- NFR-04：免登码有效期和单次使用语义由钉钉保证；应用不得重试同一个免登码。
- NFR-05：实现不得修改用户表、现有 Auth.js Cookie 名称或钉钉机器人 webhook 凭据模型。

## 验收

- 钉钉内未登录用户点击 `/briefing/123`，无需扫码即可进入对应详情。
- 钉钉内未登录用户点击 `/daily?date=2026-08-06`，免登后日期不丢失。
- 外部 Chrome 未登录时仍进入现有 `/auth/login` 二维码流程。
- 恶意 `callbackUrl=https://evil.example` 或 `//evil.example` 不能跳出本站。
- access token 获取、免登码换 userId、用户详情、停用用户拒绝、合并与 Auth.js Cookie 均有可运行测试；现有 auth/middleware 测试不回归。
