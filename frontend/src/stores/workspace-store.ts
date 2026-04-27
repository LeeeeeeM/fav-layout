import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type { WorkspaceMode } from '@/types';

const THEME_STORAGE_KEY = 'fav-layout.theme';

function readInitialTheme(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (saved === 'dark') {
    return true;
  }
  if (saved === 'light') {
    return false;
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

type WorkspaceStore = {
  mode: WorkspaceMode;
  isDark: boolean;
  libraryCollapsed: boolean;
  showHistory: boolean;
  setMode: (mode: WorkspaceMode) => void;
  setIsDark: (isDark: boolean) => void;
  setLibraryCollapsed: (collapsed: boolean) => void;
  setShowHistory: (open: boolean) => void;
  toggleLibraryCollapsed: () => void;
  toggleShowHistory: () => void;
};

export const useWorkspaceStore = create<WorkspaceStore>()(
  persist(
    (set) => ({
      mode: 'free',
      isDark: readInitialTheme(),
      libraryCollapsed: false,
      showHistory: false,
      setMode: (mode) => set({ mode }),
      setIsDark: (isDark) => set({ isDark }),
      setLibraryCollapsed: (libraryCollapsed) => set({ libraryCollapsed }),
      setShowHistory: (showHistory) => set({ showHistory }),
      toggleLibraryCollapsed: () => set((state) => ({ libraryCollapsed: !state.libraryCollapsed })),
      toggleShowHistory: () => set((state) => ({ showHistory: !state.showHistory })),
    }),
    {
      name: 'fav-layout.workspace-ui',
      partialize: (state) => ({
        mode: state.mode,
        libraryCollapsed: state.libraryCollapsed,
      }),
    },
  ),
);
