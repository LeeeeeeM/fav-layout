import { FormEvent, useEffect, useState } from 'react';
import { changePassword, getCaptcha, sendChangePasswordVerificationCode, updateProfile } from '../api';
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
  const [pwPending, setPwPending] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [showCaptchaModal, setShowCaptchaModal] = useState(false);
  const [verifyPending, setVerifyPending] = useState(false);
  const [verifyCooldownSec, setVerifyCooldownSec] = useState(0);
  const [captchaId, setCaptchaId] = useState('');
  const [captchaCode, setCaptchaCode] = useState('');
  const [captchaImage, setCaptchaImage] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [verificationCode, setVerificationCode] = useState('');

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

  async function refreshCaptcha() {
    const data = await getCaptcha();
    setCaptchaId(data.captchaId);
    setCaptchaImage(data.imageDataUrl);
    setCaptchaCode('');
  }

  async function handleRequestSendCode() {
    if (verifyCooldownSec > 0) {
      return;
    }
    try {
      await refreshCaptcha();
      setShowCaptchaModal(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '获取图形验证码失败');
    }
  }

  async function handleVerifyCaptchaAndSendCode() {
    if (!captchaId || !captchaCode.trim()) {
      toast.error('请输入图形验证码');
      return;
    }
    setVerifyPending(true);
    try {
      await sendChangePasswordVerificationCode({ captchaId, captchaCode: captchaCode.trim() });
      toast.success('验证码已发送到你的邮箱');
      setShowCaptchaModal(false);
      setVerifyCooldownSec(60);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '发送失败');
      try {
        await refreshCaptcha();
      } catch {
        // ignore
      }
    } finally {
      setVerifyPending(false);
    }
  }

  async function handleChangePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPwPending(true);
    try {
      await changePassword({
        currentPassword,
        newPassword,
        verificationCode: verificationCode.trim(),
      });
      toast.success('密码已更新');
      setCurrentPassword('');
      setNewPassword('');
      setVerificationCode('');
      setShowPasswordModal(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '修改失败');
    } finally {
      setPwPending(false);
    }
  }

  function closePasswordModal() {
    if (pwPending) {
      return;
    }
    setShowPasswordModal(false);
  }

  function closeCaptchaModal() {
    if (verifyPending) {
      return;
    }
    setShowCaptchaModal(false);
    setCaptchaCode('');
  }

  useEffect(() => {
    if (verifyCooldownSec <= 0) {
      return;
    }
    const timer = window.setTimeout(() => setVerifyCooldownSec((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => window.clearTimeout(timer);
  }, [verifyCooldownSec]);

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

        <div style={{ height: 1, background: 'hsl(var(--border))', margin: '18px 0' }} />

        <div className="profile-header" style={{ marginBottom: 10 }}>
          <div>
            <h2>安全</h2>
            <p>修改密码需要输入旧密码，并通过邮箱验证码二次验证。</p>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button
            type="button"
            variant="link"
            className="h-auto p-0"
            onClick={() => {
              setShowPasswordModal(true);
            }}
          >
            修改密码
          </Button>
        </div>
      </div>

      {showPasswordModal ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              closePasswordModal();
            }
          }}
        >
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="修改密码"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div className="modal-title">修改密码</div>
              <Button type="button" variant="ghost" size="icon" className="modal-close" onClick={closePasswordModal} aria-label="关闭">
                ×
              </Button>
            </div>

            <form className="modal-body" onSubmit={handleChangePassword}>
              <label htmlFor="profile-current-password">旧密码</label>
              <input
                id="profile-current-password"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
                required
              />

              <label htmlFor="profile-new-password">新密码</label>
              <input
                id="profile-new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                placeholder="至少 6 位"
                required
              />

              <label htmlFor="profile-email">邮箱</label>
              <input id="profile-email" value={user.email ?? ''} disabled />

              <label>邮箱验证码</label>
              <div className="side-input-row">
                <input value={verificationCode} onChange={(e) => setVerificationCode(e.target.value)} placeholder="输入6位邮箱验证码" required />
                <Button type="button" size="sm" onClick={handleRequestSendCode} disabled={pwPending || verifyCooldownSec > 0}>
                  {verifyPending ? '发送中...' : verifyCooldownSec > 0 ? `${verifyCooldownSec}s` : '发送验证码'}
                </Button>
              </div>

              <div className="modal-actions">
                <Button type="button" variant="outline" size="sm" onClick={closePasswordModal} disabled={pwPending}>
                  取消
                </Button>
                <Button type="submit" size="sm" disabled={pwPending}>
                  {pwPending ? '提交中...' : '确认修改'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {showCaptchaModal ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              closeCaptchaModal();
            }
          }}
        >
          <div className="modal" role="dialog" aria-modal="true" aria-label="图形验证码" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">请完成人机验证</div>
              <Button type="button" variant="ghost" size="icon" className="modal-close" onClick={closeCaptchaModal} aria-label="关闭">
                ×
              </Button>
            </div>
            <div className="modal-body">
              <div className="side-input-row">
                <input value={captchaCode} onChange={(e) => setCaptchaCode(e.target.value)} placeholder="请输入图片中的字符" />
                {captchaImage ? (
                  <img
                    src={captchaImage}
                    alt="图形验证码"
                    style={{ height: 44, width: 140, borderRadius: 8, border: '1px solid hsl(var(--border))', cursor: 'pointer' }}
                    onClick={() => void refreshCaptcha()}
                  />
                ) : null}
              </div>
              <div className="modal-actions">
                <Button type="button" variant="outline" size="sm" onClick={closeCaptchaModal} disabled={verifyPending}>
                  取消
                </Button>
                <Button type="button" size="sm" onClick={() => void handleVerifyCaptchaAndSendCode()} disabled={verifyPending}>
                  {verifyPending ? '验证中...' : '验证并发送'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
