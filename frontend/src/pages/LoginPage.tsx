import { FormEvent, useState } from 'react';
import { toast } from 'sonner';

type LoginPageProps = {
  loading: boolean;
  onSubmit: (username: string, password: string) => Promise<void>;
};

export default function LoginPage({ loading, onSubmit }: LoginPageProps) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('admin123');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await onSubmit(username, password);
    } catch (err) {
      const message = err instanceof Error ? err.message : '登录失败';
      toast.error(message);
    }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={handleSubmit}>
        <h1>摸鱼布局</h1>
        <p>先登录再开始摆放 B 站窗口</p>

        <label htmlFor="username">用户名</label>
        <input
          id="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          required
        />

        <label htmlFor="password">密码</label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
        <button type="submit" disabled={loading}>
          {loading ? '登录中...' : '登录'}
        </button>
      </form>
    </div>
  );
}
