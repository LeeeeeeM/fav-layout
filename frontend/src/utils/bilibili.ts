import { getBilibiliView } from '../api';

function withNoAutoplay(rawURL: string): string {
  const url = new URL(rawURL);
  url.searchParams.set('autoplay', '0');
  return url.toString();
}

export function extractBilibiliIds(text: string): { bvid?: string; aid?: string } {
  const raw = text.trim();
  if (!raw) {
    return {};
  }

  try {
    const url = new URL(raw);
    const bvidParam = url.searchParams.get('bvid');
    if (bvidParam && /^BV[0-9A-Za-z]{10}$/i.test(bvidParam)) {
      return { bvid: bvidParam };
    }
    const aidParam = url.searchParams.get('aid');
    if (aidParam && /^\d+$/.test(aidParam)) {
      return { aid: aidParam };
    }
  } catch {
    // fall through to regex-based parsing for pasted fragments
  }

  const bvid = raw.match(/BV[0-9A-Za-z]{10}/i)?.[0];
  if (bvid) {
    return { bvid };
  }

  const aidFromParam = raw.match(/[?&]aid=(\d+)/i)?.[1];
  const aidFromAv = raw.match(/(?:^|\/)av(\d+)/i)?.[1];
  const aid = aidFromParam ?? aidFromAv;
  if (aid) {
    return { aid };
  }

  return {};
}

export async function fetchBilibiliMeta(text: string): Promise<{ title: string; pic: string; upName?: string } | null> {
  const ids = extractBilibiliIds(text);
  if (!ids.bvid && !ids.aid) {
    return null;
  }
  try {
    return await getBilibiliView(ids);
  } catch {
    return null;
  }
}

export function normalizeCoverPic(pic: string): string {
  const t = pic.trim();
  if (t.startsWith('http://')) {
    return `https://${t.slice(7)}`;
  }
  return t;
}

export function toBilibiliEmbed(input: string): { title: string; embedUrl: string } | null {
  const text = input.trim();
  if (!text) {
    return null;
  }

  try {
    const url = new URL(text);

    if (url.hostname.includes('player.bilibili.com')) {
      return {
        title: url.searchParams.get('bvid') ?? url.searchParams.get('aid') ?? 'Bilibili Player',
        embedUrl: withNoAutoplay(url.toString()),
      };
    }

    const bvid = text.match(/BV[0-9A-Za-z]{10}/)?.[0];
    const aid = text.match(/(?:^|\/)av(\d+)/i)?.[1];
    const page = Number(url.searchParams.get('p') ?? '1');
    const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;

    if (bvid) {
      return {
        title: bvid,
        embedUrl: withNoAutoplay(
          `https://player.bilibili.com/player.html?bvid=${bvid}&page=${safePage}&high_quality=1&danmaku=0`,
        ),
      };
    }

    if (aid) {
      return {
        title: `av${aid}`,
        embedUrl: withNoAutoplay(
          `https://player.bilibili.com/player.html?aid=${aid}&page=${safePage}&high_quality=1&danmaku=0`,
        ),
      };
    }
  } catch {
    return null;
  }

  return null;
}
