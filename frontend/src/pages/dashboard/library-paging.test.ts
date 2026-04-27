import type { Widget } from '@/types';
import { dedupeWidgetsById, loadAllLibraryPages, nextVisibleLibrary } from './library-paging';

function makeWidget(id: string): Widget {
  return {
    id,
    title: id,
    inputUrl: `https://example.com/${id}`,
    embedUrl: `https://embed.example.com/${id}`,
    x: 0,
    y: 0,
    w: 8,
    h: 4,
  };
}

describe('library-paging', () => {
  it('dedupeWidgetsById keeps first item for duplicate ids', () => {
    const a1 = makeWidget('a');
    const a2 = { ...makeWidget('a'), title: 'newer-a' };
    const b = makeWidget('b');

    const result = dedupeWidgetsById([a1, b, a2]);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(a1);
    expect(result[1]).toEqual(b);
  });

  it('loadAllLibraryPages loads pages until hasMore is false and dedupes ids', async () => {
    const pages = [
      { offset: 0, hasMore: true, items: [makeWidget('a'), makeWidget('b')] },
      { offset: 2, hasMore: true, items: [makeWidget('b'), makeWidget('c')] },
      { offset: 4, hasMore: false, items: [makeWidget('d')] },
    ];
    const fetchPage = vi.fn(async ({ offset }: { offset: number; limit: number }) => {
      if (offset === 0) return pages[0];
      if (offset === 2) return pages[1];
      return pages[2];
    });

    const result = await loadAllLibraryPages(fetchPage, { limit: 2 });
    expect(fetchPage).toHaveBeenCalledTimes(3);
    expect(result.map((w) => w.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('nextVisibleLibrary returns expanded visible slice and hasMore flag', () => {
    const library = [makeWidget('a'), makeWidget('b'), makeWidget('c')];
    const next = nextVisibleLibrary(library, 1, 1);
    expect(next.visible.map((w) => w.id)).toEqual(['a', 'b']);
    expect(next.hasMore).toBe(true);

    const final = nextVisibleLibrary(library, 2, 4);
    expect(final.visible.map((w) => w.id)).toEqual(['a', 'b', 'c']);
    expect(final.hasMore).toBe(false);
  });
});
