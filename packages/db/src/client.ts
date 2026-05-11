import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type RuntimeKind = "web" | "worker";

export interface CreateDbClientOptions {
  runtime?: RuntimeKind;
  connectionString?: string;
}

export function getPoolSize(runtime: RuntimeKind = "web"): number {
  return runtime === "worker" ? 5 : 10;
}

export function createSqlClient(options: CreateDbClientOptions = {}): postgres.Sql {
  const connectionString = options.connectionString ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required");
  }

  return postgres(connectionString, {
    max: getPoolSize(options.runtime),
    prepare: false
  });
}

export function createDbClient(options: CreateDbClientOptions = {}) {
  const sql = createSqlClient(options);
  return drizzle(sql, { schema });
}

export type DbClient = ReturnType<typeof createDbClient>;

let defaultDb: DbClient | undefined;

export function getDb(): DbClient {
  defaultDb ??= createDbClient();
  return defaultDb;
}
