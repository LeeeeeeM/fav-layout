import { FormEvent, useEffect, useState } from 'react';
import { updateProfile } from '../api';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import type { User } from '../types';

type ProfilePageProps = {
  user: User;
  onBack: () => void;
  onProfileUpdated: (user: User) => void;
};

export default function ProfilePage({ user, onBack, onProfileUpdated }: ProfilePageProps) {
  const [nickname, setNickname] = useState(user.nickname ?? '');
  const [avatarUrl, setAvatarUrl] = useState(user.avatarUrl ?? '');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  useEffect(() => {
    setNickname(user.nickname ?? '');
    setAvatarUrl(user.avatarUrl ?? '');
  }, [user.nickname, user.avatarUrl]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setPending(true);
    try {
      const nextUser = await updateProfile({ nickname: nickname.trim(), avatarUrl: avatarUrl.trim() });
      onProfileUpdated(nextUser);
      toast.success('个人资料已保存');
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="profile-page">
      <div className="profile-card">
        <div className="profile-header">
          <div>
            <h2>个人资料</h2>
            <p>更新昵称与头像地址，用户名为只读字段。</p>
          </div>
          <Button type="button" variant="outline" onClick={onBack}>
            返回
          </Button>
        </div>

        <form className="profile-form" onSubmit={handleSubmit}>
          <div className="profile-avatar-preview">
            <div className="profile-avatar-preview-media" aria-hidden="true">
              {avatarUrl ? <img src={avatarUrl} alt="" /> : <span>{(nickname || user.username).slice(0, 1).toUpperCase()}</span>}
            </div>
            <div className="profile-avatar-preview-text">
              <div className="profile-avatar-preview-name">{nickname || user.username}</div>
              <div className="profile-avatar-preview-sub">右上角会实时使用此头像</div>
            </div>
          </div>

          <div className="profile-form-group">
            <label htmlFor="profile-username">用户名（不可修改）</label>
            <input id="profile-username" value={user.username} disabled />
          </div>

          <div className="profile-form-group">
            <label htmlFor="profile-nickname">昵称（唯一）</label>
            <input id="profile-nickname" value={nickname} onChange={(e) => setNickname(e.target.value)} required />
          </div>

          <div className="profile-form-group">
            <label htmlFor="profile-avatar-url">头像 URL</label>
            <input
              id="profile-avatar-url"
              value={avatarUrl}
              onChange={(e) => setAvatarUrl(e.target.value)}
              placeholder="https://example.com/avatar.png"
            />
          </div>

          {error ? <div className="error-text">{error}</div> : null}

          <div className="profile-actions">
            <Button type="submit" disabled={pending}>
              {pending ? '保存中...' : '保存'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
