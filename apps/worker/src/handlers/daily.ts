import { runDailyGen } from "../jobs/daily-gen";

import { logger, handlerContext } from "./context";

export async function handleDailyJob(): Promise<void> {
  // Kimi 网关无公网出口（转发 api.moonshot.cn 超时），改用同网关可达的 DeepSeek
  await runDailyGen(handlerContext.deepSeek);
  logger.info("daily report generated");
}
