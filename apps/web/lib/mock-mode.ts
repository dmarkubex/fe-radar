// Mock 演示模式：仅本机 / 测试环境使用，让前端能在无 DB / Redis / LLM 下跑通页面。
// 严禁在生产构建中启用：本文件在模块加载期就会校验 NODE_ENV，prod 下打开 mock 直接抛错。
//
// 注意：APP_DATA_MODE 是 server-only 配置，禁止使用 NEXT_PUBLIC_* 前缀
// （那会被 Next.js 注入到客户端 bundle，任何人都能在 DevTools 看到，
// 攻击者可以据此判断站点是否进入 mock auth / mock write 路径）。

const MOCK_MODE = process.env.APP_DATA_MODE === "mock";

if (MOCK_MODE && process.env.NODE_ENV === "production") {
  throw new Error(
    "[mock-mode] APP_DATA_MODE=mock 不允许出现在生产构建中。mock 模式仅供本地 / 测试环境使用，prod 必须关闭。"
  );
}

export function isMockMode(): boolean {
  return MOCK_MODE;
}
