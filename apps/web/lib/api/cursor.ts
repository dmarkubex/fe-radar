export interface CursorPayload {
  scoredAt: string;
  id: number;
}

export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeCursor(cursor: string | undefined): CursorPayload | null {
  if (!cursor) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Partial<CursorPayload>;
    if (!parsed.scoredAt || typeof parsed.id !== "number") {
      return null;
    }
    return { scoredAt: parsed.scoredAt, id: parsed.id };
  } catch {
    return null;
  }
}
