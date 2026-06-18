import { dayjs } from "@fe-radar/shared";

export interface CursorPayload {
  at: string;
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
    const id = parsed.id;
    if (!parsed.at || typeof parsed.at !== "string" || typeof id !== "number" || !Number.isInteger(id) || !Number.isFinite(id)) {
      return null;
    }
    if (!dayjs(parsed.at).isValid()) {
      return null;
    }
    return { at: parsed.at, id };
  } catch {
    return null;
  }
}
