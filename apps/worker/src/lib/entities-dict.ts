export interface EntityDictionaryEntry {
  id: number;
  type: string;
  canonicalName: string;
  aliases: string[];
  circle?: "C1" | "C2" | "C3" | null;
}

export interface EntityDictionaryHit extends EntityDictionaryEntry {
  span: string;
}

export class EntityDictionary {
  public constructor(private readonly entries: EntityDictionaryEntry[]) {}

  public match(text: string): EntityDictionaryHit[] {
    const hits: EntityDictionaryHit[] = [];
    for (const entry of this.entries) {
      for (const alias of [entry.canonicalName, ...entry.aliases]) {
        if (alias.length > 0 && text.includes(alias)) {
          hits.push({ ...entry, span: alias });
          break;
        }
      }
    }
    return hits;
  }
}

export function detectPolicyEntities(text: string): Array<{ type: "policy"; span: string; canonicalName: string }> {
  const matches = text.match(/(?:GB|DL|NB|T)\/?T?\s?\d{3,6}(?:-\d{4})?/gi) ?? [];
  return matches.map((span) => ({
    type: "policy",
    span,
    canonicalName: span.replace(/\s+/g, "").toUpperCase(),
  }));
}
