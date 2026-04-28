import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { login, logout, me, register } from './api';
import { Toaster } from './components/ui/sonner';
import DashboardPage from './pages/DashboardPage';
import ProfilePage from './pages/ProfilePage';
import { useWorkspaceStore } from './stores/workspace-store';
import type { User } from './types';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const isDark = useWorkspaceStore((s) => s.isDark);
  const navigate = useNavigate();

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
      } finally {
        if (!canceled) {
          setAuthReady(true);
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

  async function handleRegister(username: string, email: string, password: string, verificationCode: string) {
    const authUser = await register({ username, email, password, nickname: '', verificationCode });
    setUser(authUser);
  }

  async function handleLogout() {
    await logout();
    setUser(null);
  }

  function handleProfileUpdated(nextUser: User) {
    setUser(nextUser);
  }

  return (
    <>
      <Routes>
        <Route
          path="/"
          element={
            <DashboardPage
              user={user}
              onLogin={handleLogin}
              onRegister={handleRegister}
              onLogout={handleLogout}
              onOpenProfile={() => navigate('/profile')}
            />
          }
        />
        <Route
          path="/profile"
          element={
            !authReady ? (
              <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
                正在加载用户信息...
              </div>
            ) : user ? (
              <ProfilePage user={user} onBack={() => navigate('/')} onProfileUpdated={handleProfileUpdated} />
            ) : (
              <Navigate to="/" replace />
            )
          }
        />
      </Routes>
      <Toaster position="top-center" richColors closeButton theme={isDark ? 'dark' : 'light'} />
    </>
  );
}
