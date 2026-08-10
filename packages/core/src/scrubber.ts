import { createHash } from "node:crypto";

export type RedactionType = "PHONE" | "ID_CARD" | "EMAIL" | "INTERNAL_IP" | "MAC" | "PROJECT_CODE";
export type ScrubLevel = "safe" | "redacted" | "block";

export interface Redaction {
  type: RedactionType;
  hash8: string;
  count: number;
}

export interface ScrubContext {
  itemId?: number;
  projectCodes?: string[];
  blockThreshold?: number;
}

export interface ScrubResult {
  cleaned: string;
  redactions: Redaction[];
  level: ScrubLevel;
  audit: {
    itemId?: number;
    counts: Partial<Record<RedactionType, number>>;
  };
}

const PATTERNS: Array<{ type: RedactionType; regex: RegExp }> = [
  { type: "EMAIL", regex: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi },
  { type: "PHONE", regex: /(?<!\d)1[3-9]\d{9}(?!\d)/g },
  { type: "ID_CARD", regex: /(?<!\d)\d{17}[\dXx](?!\d)/g },
  { type: "INTERNAL_IP", regex: /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})\b/g },
  { type: "MAC", regex: /\b[0-9A-F]{2}(?::[0-9A-F]{2}){5}\b/gi }
];

export function scrubText(input: string, context: ScrubContext = {}): ScrubResult {
  const found = new Map<RedactionType, Set<string>>();
  let cleaned = input;

  for (const pattern of PATTERNS) {
    cleaned = replaceMatches(cleaned, pattern.type, pattern.regex, found);
  }

  // Longest codes first so short codes that are substrings of longer ones
  // (e.g. "ZX" vs "ZX-2026") cannot fragment a match and leave residue.
  // Sort a copy — never mutate the caller's projectCodes array.
  const projectCodes = [...(context.projectCodes ?? [])].sort((a, b) => b.length - a.length);
  for (const code of projectCodes) {
    if (code.trim().length === 0) continue;
    cleaned = replaceMatches(cleaned, "PROJECT_CODE", new RegExp(escapeRegExp(code), "g"), found);
  }

  const redactions = [...found.entries()].map(([type, values]) => ({
    type,
    hash8: hash8([...values].join("|")),
    count: values.size
  }));
  const counts = Object.fromEntries(redactions.map((item) => [item.type, item.count])) as Partial<Record<RedactionType, number>>;
  const piiCount = (counts.PHONE ?? 0) + (counts.ID_CARD ?? 0) + (counts.INTERNAL_IP ?? 0);
  const blockThreshold = context.blockThreshold ?? 3;
  const level: ScrubLevel = redactions.length === 0 ? "safe" : piiCount >= blockThreshold || Boolean(counts.INTERNAL_IP) ? "block" : "redacted";

  return {
    cleaned,
    redactions,
    level,
    audit: {
      itemId: context.itemId,
      counts
    }
  };
}

function replaceMatches(input: string, type: RedactionType, regex: RegExp, found: Map<RedactionType, Set<string>>): string {
  return input.replace(regex, (match: string) => {
    const values = found.get(type) ?? new Set<string>();
    values.add(match);
    found.set(type, values);
    return `[REDACTED:${type}:${hash8(match)}]`;
  });
}

function hash8(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 8);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
