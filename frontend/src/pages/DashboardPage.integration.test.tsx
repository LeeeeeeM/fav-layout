import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DashboardPage from './DashboardPage';

vi.mock('../api', () => ({
  getLayout: vi.fn(),
  getLibraryPage: vi.fn(),
  saveLayout: vi.fn(),
  saveLibrary: vi.fn(),
}));

vi.mock('react-grid-layout', async () => {
  const React = await import('react');
  const MockGrid = (props: React.PropsWithChildren<Record<string, unknown>>) => <div>{props.children}</div>;
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
  beforeEach(async () => {
    vi.useFakeTimers();
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
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('switching mode only persists layout (not library)', async () => {
    const api = await import('../api');
    render(<DashboardPage user={{ id: 1, username: 'admin' }} onLogin={vi.fn()} onLogout={vi.fn()} />);

    await waitFor(() => {
      expect(api.getLayout).toHaveBeenCalledTimes(1);
    });

    vi.runAllTimers();
    vi.clearAllMocks();

    fireEvent.click(screen.getByRole('radio', { name: '分屏模式' }));
    vi.advanceTimersByTime(700);

    await waitFor(() => {
      expect(api.saveLayout).toHaveBeenCalledTimes(1);
    });
    expect(api.saveLibrary).not.toHaveBeenCalled();
  });
});
