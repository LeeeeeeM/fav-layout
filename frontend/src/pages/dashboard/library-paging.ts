import type { Widget } from '@/types';

export type LibraryPage = {
  items: Widget[];
  offset: number;
  hasMore: boolean;
};

export function dedupeWidgetsById(items: Widget[]): Widget[] {
  const seen = new Set<string>();
  const out: Widget[] = [];
  for (const w of items) {
    if (seen.has(w.id)) {
      continue;
    }
    seen.add(w.id);
    out.push(w);
  }
  return out;
}

export async function loadAllLibraryPages(
  fetchPage: (params: { offset: number; limit: number }) => Promise<LibraryPage>,
  opts: { limit?: number } = {},
): Promise<Widget[]> {
  const limit = opts.limit ?? 50;
  const all: Widget[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const page = await fetchPage({ offset, limit });
    all.push(...page.items);
    offset = page.offset + page.items.length;
    hasMore = page.hasMore && page.items.length > 0;
  }

  return dedupeWidgetsById(all);
}

export function nextVisibleLibrary(
  library: Widget[],
  currentVisibleCount: number,
  pageSize: number,
): { visible: Widget[]; hasMore: boolean } {
  const nextCount = Math.min(library.length, currentVisibleCount + pageSize);
  return {
    visible: library.slice(0, nextCount),
    hasMore: nextCount < library.length,
  };
}
