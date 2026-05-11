import type { StandardItem } from "./fetchers";

export interface DedupCandidate extends StandardItem {
  sourceId: number;
}

export interface ExistingItemFingerprint {
  sourceId: number;
  url: string;
  title: string;
  publishedDate: string;
}

export interface DedupResult {
  accepted: DedupCandidate[];
  skipped: DedupCandidate[];
}

export function normalizeTitle(title: string): string {
  return title.trim().replace(/\s+/g, " ");
}

export function businessDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function dedupItems(candidates: DedupCandidate[], existing: ExistingItemFingerprint[]): DedupResult {
  const seenUrls = new Set(existing.map((item) => item.url));
  const seenTitleDates = new Set(existing.map((item) => fingerprint(item.sourceId, item.title, item.publishedDate)));
  const accepted: DedupCandidate[] = [];
  const skipped: DedupCandidate[] = [];

  for (const candidate of candidates) {
    const titleDate = fingerprint(candidate.sourceId, candidate.title, businessDate(candidate.publishedAt));
    if (seenUrls.has(candidate.url) || seenTitleDates.has(titleDate)) {
      skipped.push(candidate);
      continue;
    }

    seenUrls.add(candidate.url);
    seenTitleDates.add(titleDate);
    accepted.push(candidate);
  }

  return { accepted, skipped };
}

function fingerprint(sourceId: number, title: string, date: string): string {
  return `${sourceId}:${normalizeTitle(title)}:${date}`;
}
