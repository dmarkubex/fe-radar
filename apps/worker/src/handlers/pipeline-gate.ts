import { itemAnalysis } from "@fe-radar/db";
import type { DbClient } from "@fe-radar/db";
import { eq } from "drizzle-orm";

export async function passesIndustryGate(db: DbClient, itemId: number): Promise<boolean> {
  const [analysis] = await db.select({
    isIndustryRelated: itemAnalysis.isIndustryRelated,
  }).from(itemAnalysis).where(eq(itemAnalysis.itemId, itemId)).limit(1);

  return analysis?.isIndustryRelated === true;
}
