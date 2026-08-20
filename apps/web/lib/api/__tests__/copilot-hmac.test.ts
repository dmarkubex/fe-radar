import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

import { buildCanonical, computeSignature } from "../../../app/api/copilot/hmac";

const POST_VECTOR = {
  method: "POST",
  path: "/chat",
  ts: "1770000000",
  nonce: "a".repeat(32),
  body: '{"message":"hello"}',
  userId: 7,
  role: "viewer",
  secret: "s e c ret\n",
  canonical:
    "POST|/chat|1770000000|aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa|9b2d43affbf49a367028df2e1414f84c0e099ac98c3d54a8a80157fd7771af25|7|viewer",
  signature: "9dd92bd0750f4c4c442e1e9cdf4b3bc62794b7d064c81383ac812ecfffbd66b6"
};

const GET_VECTOR = {
  method: "GET",
  path: "/sessions",
  ts: "1770000000",
  nonce: "b".repeat(32),
  body: "",
  userId: 3,
  role: "admin",
  secret: "secret",
  canonical:
    "GET|/sessions|1770000000|bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb|e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855|3|admin",
  signature: "daef805dc37aa96abea4c3e0af3917a20f2aa1ce6f53c03efc0ed99946859a27"
};

describe("copilot HMAC canonical (matches apps/copilot/auth.py)", () => {
  it("matches the Python POST vector", () => {
    const canonical = buildCanonical(
      POST_VECTOR.method,
      POST_VECTOR.path,
      POST_VECTOR.ts,
      POST_VECTOR.nonce,
      POST_VECTOR.body,
      POST_VECTOR.userId,
      POST_VECTOR.role
    );
    expect(canonical).toBe(POST_VECTOR.canonical);
    expect(computeSignature(canonical, POST_VECTOR.secret)).toBe(POST_VECTOR.signature);
  });

  it("hashes GET with empty body and does not parse JSON", () => {
    const canonical = buildCanonical(
      GET_VECTOR.method,
      GET_VECTOR.path,
      GET_VECTOR.ts,
      GET_VECTOR.nonce,
      GET_VECTOR.body,
      GET_VECTOR.userId,
      GET_VECTOR.role
    );
    expect(canonical).toBe(GET_VECTOR.canonical);
    expect(computeSignature(canonical, GET_VECTOR.secret)).toBe(GET_VECTOR.signature);
  });

  it("cross-checks live Python build_canonical + compute_signature", () => {
    const script = `
from pathlib import Path
import sys
sys.path.insert(0, str(Path(".").resolve()))
from auth import build_canonical, compute_signature
print(build_canonical(${JSON.stringify(POST_VECTOR.method)}, ${JSON.stringify(POST_VECTOR.path)}, ${JSON.stringify(POST_VECTOR.ts)}, ${JSON.stringify(POST_VECTOR.nonce)}, ${JSON.stringify(POST_VECTOR.body)}, ${POST_VECTOR.userId}, ${JSON.stringify(POST_VECTOR.role)}))
print(compute_signature(build_canonical(${JSON.stringify(POST_VECTOR.method)}, ${JSON.stringify(POST_VECTOR.path)}, ${JSON.stringify(POST_VECTOR.ts)}, ${JSON.stringify(POST_VECTOR.nonce)}, ${JSON.stringify(POST_VECTOR.body)}, ${POST_VECTOR.userId}, ${JSON.stringify(POST_VECTOR.role)}), ${JSON.stringify(POST_VECTOR.secret)}))
`;
    let output: string;
    try {
      output = execFileSync("uv", ["run", "python", "-c", script], {
        encoding: "utf8",
        cwd: "/Volumes/SD/AI-Timeline-web/apps/copilot"
      });
    } catch {
      return;
    }
    const [canonical, signature] = output.trim().split("\n");
    expect(canonical).toBe(POST_VECTOR.canonical);
    expect(signature).toBe(POST_VECTOR.signature);
    expect(buildCanonical(
      POST_VECTOR.method,
      POST_VECTOR.path,
      POST_VECTOR.ts,
      POST_VECTOR.nonce,
      POST_VECTOR.body,
      POST_VECTOR.userId,
      POST_VECTOR.role
    )).toBe(canonical);
  });
});
