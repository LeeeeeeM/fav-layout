import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DashboardPage from './DashboardPage';

vi.mock('../api', () => ({
  getLayout: vi.fn(),
  getLibraryPage: vi.fn(),
  saveLayout: vi.fn(),
  saveLibrary: vi.fn(),
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
    const { unmount } = render(<DashboardPage user={{ id: 1, username: 'admin' }} onLogin={vi.fn()} onLogout={vi.fn()} />);

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
});
