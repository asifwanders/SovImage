import type { SearchHit } from "./types";

export const HIGHLIGHT_START = "\u0001";
export const HIGHLIGHT_END = "\u0002";

export function toFtsPhrase(query: string) {
  return `"${query.replaceAll('"', '""')}"`;
}

export function splitHighlight(snippet: string) {
  const parts: Array<{ text: string; highlighted: boolean }> = [];
  let highlighted = false;
  let start = 0;
  for (let i = 0; i < snippet.length; i++) {
    const marker = snippet[i];
    if (marker !== HIGHLIGHT_START && marker !== HIGHLIGHT_END) continue;
    if (i > start) parts.push({ text: snippet.slice(start, i), highlighted });
    highlighted = marker === HIGHLIGHT_START;
    start = i + 1;
  }
  if (start < snippet.length) {
    parts.push({ text: snippet.slice(start), highlighted });
  }
  return parts;
}

export function retainExistingSearchHits(
  hits: SearchHit[],
  chatIds: Iterable<string>,
) {
  const existing = new Set(chatIds);
  return hits.filter((hit) => existing.has(hit.chatId));
}
