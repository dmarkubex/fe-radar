// mock 演示模式是只读降级状态：写操作在演示环境无意义且会产生幻假 id，
// 统一返回 503 而非 403/405，语义为「当前模式暂时不支持写入」。
export function mockReadonlyResponse(): Response {
  return Response.json(
    { error: { code: "MOCK_READONLY", message: "演示模式不可写" } },
    { status: 503 }
  );
}
