import { createHash, createHmac, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

import type { UserRole } from "@fe-radar/shared";

/**
 * Canonical 与 `apps/copilot/auth.py:build_canonical` 同一公式。
 * 禁止改 Python；此处只复制公式。
 */
export function buildCanonical(
  method: string,
  path: string,
  ts: string,
  nonce: string,
  body: string,
  userId: number,
  role: string
): string {
  const bodyHash = createHash("sha256").update(body, "utf8").digest("hex");
  return `${method}|${path}|${ts}|${nonce}|${bodyHash}|${userId}|${role}`;
}

/** 与 `auth.py:compute_signature` 相同：secret 去全部空白后再 HMAC-SHA256 hex。 */
export function computeSignature(canonical: string, secret: string): string {
  const key = secret.replace(/\s+/g, "");
  return createHmac("sha256", key).update(canonical, "utf8").digest("hex");
}

export function readCopilotInternalSecret(): string {
  const filePath = process.env.COPILOT_INTERNAL_SECRET_FILE;
  if (!filePath) {
    throw new Error("COPILOT_INTERNAL_SECRET_FILE is not set");
  }
  return readFileSync(filePath, "utf8").trim();
}

export function buildCopilotAuthHeaders(input: {
  method: string;
  path: string;
  body: string;
  userId: number;
  role: UserRole;
  secret: string;
  nowSec?: number;
  nonce?: string;
}): Record<string, string> {
  const ts = String(input.nowSec ?? Math.floor(Date.now() / 1000));
  const nonce = input.nonce ?? randomBytes(16).toString("hex");
  const canonical = buildCanonical(
    input.method,
    input.path,
    ts,
    nonce,
    input.body,
    input.userId,
    input.role
  );
  const signature = computeSignature(canonical, input.secret);
  const user = Buffer.from(JSON.stringify({ userId: input.userId, role: input.role }), "utf8").toString(
    "base64"
  );
  return {
    "x-fer-ts": ts,
    "x-fer-nonce": nonce,
    "x-fer-user": user,
    "x-fer-internal-auth": signature
  };
}
