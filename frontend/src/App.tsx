import { useEffect, useState } from 'react';
import { login, logout, me } from './api';
import { Toaster } from './components/ui/sonner';
import DashboardPage from './pages/DashboardPage';
import { useWorkspaceStore } from './stores/workspace-store';
import type { User } from './types';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const isDark = useWorkspaceStore((s) => s.isDark);

  useEffect(() => {
    let canceled = false;

    async function bootstrap() {
      try {
        const authUser = await me();
        if (!canceled) {
          setUser(authUser);
        }
      } catch {
        if (!canceled) {
          setUser(null);
        }
      }
    }

    void bootstrap();

    return () => {
      canceled = true;
    };
  }, []);

  async function handleLogin(username: string, password: string) {
    const authUser = await login(username, password);
    setUser(authUser);
  }

  async function handleLogout() {
    await logout();
    setUser(null);
  }

  return (
    <>
      <DashboardPage user={user} onLogin={handleLogin} onLogout={handleLogout} />
      <Toaster position="top-center" richColors closeButton theme={isDark ? 'dark' : 'light'} />
    </>
  );
}
