import { runDailyGen } from "../jobs/daily-gen";

import { logger, handlerContext } from "./context";

export async function handleDailyJob(): Promise<void> {
  await runDailyGen(handlerContext.kimi);
  logger.info("daily report generated");
}
