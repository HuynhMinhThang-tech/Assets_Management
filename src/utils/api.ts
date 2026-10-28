import type { UserFinancialState } from '../types/finance';
import type { AdminAccount, PublicUser } from './auth';

/** Lỗi khi gọi máy chủ. status = 0 nghĩa là không kết nối được. */
export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string, public data?: any) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH',
  path: string,
  body?: unknown,
  opts: { keepalive?: boolean } = {}
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: method === 'GET' ? undefined : { 'Content-Type': 'application/json' },
      body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
      keepalive: opts.keepalive,
    });
  } catch {
    throw new ApiError('Không kết nối được máy chủ. Hãy kiểm tra mạng rồi thử lại.', 0, 'network');
  }
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    /* phản hồi không phải JSON */
  }
  if (!res.ok) throw new ApiError(data?.error || `Lỗi máy chủ (${res.status}).`, res.status, data?.code, data);
  return data as T;
}

export const api = {
  me: () => request<{ user: PublicUser }>('GET', '/api/auth/me'),
  register: (input: { displayName: string; email: string; password: string }) =>
    request<{ status: 'active' | 'pending'; user?: PublicUser }>('POST', '/api/auth/register', input),
  login: (input: { email: string; password: string; remember: boolean }) =>
    request<{ user: PublicUser }>('POST', '/api/auth/login', input),
  logout: () => request<{ ok: true }>('POST', '/api/auth/logout'),
  forgot: (input: { email: string; password: string }) => request<{ ok: true }>('POST', '/api/auth/forgot', input),
  changePassword: (input: { current: string; next: string }) => request<{ ok: true }>('POST', '/api/auth/password', input),
  updateProfile: (displayName: string) => request<{ user: PublicUser }>('PATCH', '/api/auth/profile', { displayName }),

  listAccounts: () => request<{ accounts: AdminAccount[] }>('GET', '/api/admin/accounts'),
  adminAction: (
    id: string,
    action: 'approve' | 'reject' | 'lock' | 'promote' | 'demote' | 'reset-approve' | 'reset-deny' | 'delete'
  ) => request<{ ok: true }>('POST', `/api/admin/accounts/${id}/${action}`),

  getPortfolio: () => request<{ data: UserFinancialState | null; version: number }>('GET', '/api/portfolio'),
  savePortfolio: (data: UserFinancialState, baseVersion: number, opts?: { keepalive?: boolean }) =>
    request<{ version: number }>('PUT', '/api/portfolio', { data, baseVersion }, opts),
};
