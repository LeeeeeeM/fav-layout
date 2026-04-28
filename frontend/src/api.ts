import type { LayoutPayload, User, Widget } from './types';

const API_BASE = import.meta.env.VITE_API_BASE ?? '';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  if (!res.ok) {
    let message = `Request failed: ${res.status}`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) {
        message = data.error;
      }
    } catch {
      // ignore JSON parse errors
    }
    throw new Error(message);
  }

  return (await res.json()) as T;
}

export async function login(username: string, password: string): Promise<User> {
  const data = await request<{ user: User }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  return data.user;
}

export async function register(params: {
  username: string;
  email: string;
  password: string;
  nickname: string;
  verificationCode: string;
}): Promise<User> {
  const data = await request<{ user: User }>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(params),
  });
  return data.user;
}

export async function sendRegisterVerificationCode(params: { email: string; captchaId: string; captchaCode: string }): Promise<void> {
  await request<{ ok: boolean }>('/api/auth/email-verification/register', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function getCaptcha(): Promise<{ captchaId: string; imageBase64: string; imageDataUrl: string }> {
  return request<{ captchaId: string; imageBase64: string; imageDataUrl: string }>('/api/auth/captcha');
}

export async function me(): Promise<User> {
  const data = await request<{ user: User }>('/api/auth/me');
  return data.user;
}

export async function getProfile(): Promise<User> {
  const data = await request<{ user: User }>('/api/profile');
  return data.user;
}

export async function updateProfile(payload: { nickname: string; avatarUrl: string }): Promise<User> {
  const data = await request<{ user: User }>('/api/profile', {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  return data.user;
}

export async function logout(): Promise<void> {
  await request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' });
}

export async function getLayout(): Promise<LayoutPayload> {
  return request<LayoutPayload>('/api/layout');
}

export async function saveLayout(payload: LayoutPayload): Promise<void> {
  await request<{ ok: boolean }>('/api/layout', {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export type LibraryPageResponse = {
  items: Widget[];
  offset: number;
  limit: number;
  hasMore: boolean;
  total: number;
};

export async function saveLibrary(items: Widget[]): Promise<void> {
  await request<{ ok: boolean }>('/api/library', {
    method: 'PUT',
    body: JSON.stringify({ items }),
  });
}

export async function getLibraryPage(params: { offset: number; limit: number }): Promise<LibraryPageResponse> {
  const qs = new URLSearchParams({
    offset: String(params.offset),
    limit: String(params.limit),
  });
  return request<LibraryPageResponse>(`/api/library?${qs.toString()}`);
}

export async function getBilibiliView(params: { bvid?: string; aid?: string }): Promise<{ title: string; pic: string; upName?: string }> {
  const qs = params.bvid
    ? `bvid=${encodeURIComponent(params.bvid)}`
    : `aid=${encodeURIComponent(params.aid ?? '')}`;
  const res = await fetch(`${API_BASE}/api/bilibili/view?${qs}`, {
    credentials: 'include',
  });
  if (!res.ok) {
    let message = `Request failed: ${res.status}`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) {
        message = data.error;
      }
    } catch {
      // ignore JSON parse errors
    }
    throw new Error(message);
  }
  return (await res.json()) as { title: string; pic: string; upName?: string };
}
