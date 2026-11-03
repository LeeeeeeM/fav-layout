import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DashboardPage from './DashboardPage';

vi.mock('../api', () => ({
  getLayout: vi.fn(),
  getLibraryPage: vi.fn(),
  saveLayout: vi.fn(),
  saveLibrary: vi.fn(),
  getCaptcha: vi.fn(),
  sendRegisterVerificationCode: vi.fn(),
}));

vi.mock('react-grid-layout', async () => {
  const MockGrid = (props: { children?: ReactNode }) => <div>{props.children}</div>;
  return {
    __esModule: true,
    default: MockGrid,
    WidthProvider: (Comp: typeof MockGrid) => Comp,
  };
});

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    error: vi.fn(),
    success: vi.fn(),
  }),
}));

describe('DashboardPage integration', () => {
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  beforeEach(async () => {
    const api = await import('../api');
    vi.mocked(api.getLayout).mockResolvedValue({
      items: [],
      mode: 'free',
      splitRoot: { kind: 'leaf', id: 'root' },
    });
    vi.mocked(api.getLibraryPage).mockResolvedValue({
      items: [],
      offset: 0,
      limit: 50,
      hasMore: false,
      total: 0,
    });
    vi.mocked(api.saveLayout).mockResolvedValue();
    vi.mocked(api.saveLibrary).mockResolvedValue();

    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
    window.matchMedia = vi.fn().mockImplementation(() => ({
      matches: false,
      media: '',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('switching mode only persists layout (not library)', async () => {
    const api = await import('../api');
    const { unmount } = render(
      <DashboardPage
        user={{ id: 1, username: 'admin', email: 'admin@example.com', nickname: 'admin', avatarUrl: '' }}
        authReady
        onLogin={vi.fn()}
        onRegister={vi.fn()}
        onLogout={vi.fn()}
        onOpenProfile={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(api.getLayout).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      await sleep(700);
    });
    vi.clearAllMocks();

    fireEvent.click(screen.getByText('分屏模式'));

    await act(async () => {
      await sleep(700);
    });

    await waitFor(
      () => {
        expect(api.saveLayout).toHaveBeenCalledTimes(1);
      },
      { timeout: 2500 },
    );
    expect(api.saveLibrary).not.toHaveBeenCalled();

    unmount();
  });

  it('does not show localStorage videos before auth is ready or after login', async () => {
    const api = await import('../api');
    window.localStorage.setItem(
      'fav-layout.workspace',
      JSON.stringify({
        items: [
          {
            id: 'local-a',
            title: '本地视频A',
            inputUrl: 'https://www.bilibili.com/video/BV1ZuKc62E8t',
            embedUrl: 'https://player.bilibili.com/player.html?bvid=BV1ZuKc62E8t',
            x: 0,
            y: 0,
            w: 8,
            h: 6,
          },
          {
            id: 'local-b',
            title: '本地视频B',
            inputUrl: 'https://www.bilibili.com/video/BV1ZuKc62E8t',
            embedUrl: 'https://player.bilibili.com/player.html?bvid=BV1ZuKc62E8t',
            x: 8,
            y: 0,
            w: 8,
            h: 6,
          },
        ],
        library: [],
        mode: 'free',
      }),
    );
    vi.mocked(api.getLayout).mockResolvedValue({
      items: [
        {
          id: 'remote-1',
          title: '账号视频',
          inputUrl: 'https://www.bilibili.com/video/BV1G2Hy6KENA',
          embedUrl: 'https://player.bilibili.com/player.html?bvid=BV1G2Hy6KENA',
          x: 6,
          y: 0,
          w: 8,
          h: 5,
        },
      ],
      mode: 'free',
      splitRoot: { kind: 'leaf', id: 'root' },
    });

    const { rerender } = render(
      <DashboardPage
        user={null}
        authReady={false}
        onLogin={vi.fn()}
        onRegister={vi.fn()}
        onLogout={vi.fn()}
        onOpenProfile={vi.fn()}
      />,
    );

    expect(screen.getByText('正在加载布局...')).toBeTruthy();
    expect(screen.queryByText('本地视频A')).toBeNull();
    expect(screen.queryByText('本地视频B')).toBeNull();
    expect(api.getLayout).not.toHaveBeenCalled();

    rerender(
      <DashboardPage
        user={{ id: 1, username: 'admin', email: 'admin@example.com', nickname: 'admin', avatarUrl: '' }}
        authReady
        onLogin={vi.fn()}
        onRegister={vi.fn()}
        onLogout={vi.fn()}
        onOpenProfile={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('账号视频')).toBeTruthy();
    });
    expect(screen.queryByText('本地视频A')).toBeNull();
    expect(screen.queryByText('本地视频B')).toBeNull();
  });
});
