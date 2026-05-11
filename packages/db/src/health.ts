import type { HealthCheckResult } from "@fe-radar/shared";
import { createSqlClient, type RuntimeKind } from "./client";

export interface HealthOptions {
  runtime?: RuntimeKind;
  connectionString?: string;
  timeoutMs?: number;
}

export async function health(options: HealthOptions = {}): Promise<HealthCheckResult> {
  const startedAt = Date.now();
  let sql;

  try {
    sql = createSqlClient({
      runtime: options.runtime,
      connectionString: options.connectionString
    });

    const timeoutMs = options.timeoutMs ?? 5000;
    await Promise.race([
      sql`CREATE EXTENSION IF NOT EXISTS vector`,
      new Promise((_, reject) => setTimeout(() => reject(new Error("DB health check timeout")), timeoutMs))
    ]);
    await sql`SELECT 1`;

    return { ok: true, latencyMs: Date.now() - startedAt };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : "Unknown database health error"
    };
  } finally {
    await sql?.end({ timeout: 1 });
  }
}
