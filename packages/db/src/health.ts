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
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("DB health check timeout")), timeoutMs)
    );

    await Promise.race([sql`SELECT 1`, timeout]);

    const rows = (await Promise.race([
      sql`SELECT 1 FROM pg_extension WHERE extname = 'vector'`,
      timeout
    ])) as ReadonlyArray<unknown>;

    if (rows.length === 0) {
      return {
        ok: false,
        latencyMs: Date.now() - startedAt,
        error: "pgvector extension not installed (run CREATE EXTENSION vector as a superuser via migration)"
      };
    }

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
