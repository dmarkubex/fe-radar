import { describe, expect, it } from "vitest";

import { decodeCursor, encodeCursor } from "../cursor";

describe("timeline cursor codec", () => {
  it("roundtrips the generalized at/id payload for all timeline modes", () => {
    const cases = [
      { mode: "default", at: "2026-06-18T08:00:00.000Z", id: 101 },
      { mode: "curated", at: "2026-06-18T07:30:00.000Z", id: 102 },
      { mode: "alerts", at: "2026-06-18T07:15:00.000Z", id: 103 }
    ];

    for (const entry of cases) {
      const cursor = encodeCursor({ at: entry.at, id: entry.id });
      expect(decodeCursor(cursor), entry.mode).toEqual({ at: entry.at, id: entry.id });
    }
  });

  it("returns null for old scoredAt/id cursors instead of throwing", () => {
    const oldCursor = Buffer.from(JSON.stringify({ scoredAt: "2026-06-18T08:00:00.000Z", id: 101 }), "utf8").toString("base64url");

    expect(() => decodeCursor(oldCursor)).not.toThrow();
    expect(decodeCursor(oldCursor)).toBeNull();
  });

  it("rejects malformed at/id payloads", () => {
    const badTimestamp = Buffer.from(JSON.stringify({ at: "not-a-date", id: 1 }), "utf8").toString("base64url");
    const badId = Buffer.from(JSON.stringify({ at: "2026-06-18T08:00:00.000Z", id: "1" }), "utf8").toString("base64url");

    expect(decodeCursor(badTimestamp)).toBeNull();
    expect(decodeCursor(badId)).toBeNull();
  });
});
