export function safeExternalUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

export function safeItemHref(value: string | null | undefined): string | null {
  if (value && /^\/items\/\d+$/.test(value)) return value;
  return safeExternalUrl(value);
}
