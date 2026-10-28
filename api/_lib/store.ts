export type Role = 'admin' | 'user';
export type Status = 'pending' | 'active' | 'rejected' | 'locked';

export interface UserRecord {
  id: string;
  email: string;
  emailCanonical: string;
  displayName: string;
  passwordHash: string;
  role: Role;
  status: Status;
  resetRequestHash: string | null;
  resetRequestedAt: string | null;
  failedLogins: number;
  lockedUntil: string | null;
  createdAt: string;
  approvedAt: string | null;
}

export interface NewUser {
  email: string;
  emailCanonical: string;
  displayName: string;
  passwordHash: string;
  role: Role;
  status: Status;
}

export type SaveResult = { ok: true; version: number } | { ok: false; version: number };

/** Lớp truy cập dữ liệu. Có hai bản cài đặt: Neon (neon-store.ts) và trong bộ nhớ (memory-store.ts, dùng cho kiểm thử). */
export interface Store {
  countAdmins(): Promise<number>;
  findUserById(id: string): Promise<UserRecord | null>;
  findUserByCanonical(canonical: string): Promise<UserRecord | null>;
  listUsers(): Promise<UserRecord[]>;
  /** null nếu Gmail đã tồn tại. */
  createUser(input: NewUser): Promise<UserRecord | null>;
  setStatus(id: string, status: Status): Promise<void>;
  setRole(id: string, role: Role): Promise<void>;
  /** Đặt mật khẩu mới: xóa luôn yêu cầu đặt lại và bộ đếm đăng nhập sai. */
  setPassword(id: string, passwordHash: string): Promise<void>;
  setResetRequest(id: string, hash: string | null): Promise<void>;
  setDisplayName(id: string, displayName: string): Promise<void>;
  recordLoginFailure(id: string): Promise<void>;
  clearLoginFailures(id: string): Promise<void>;
  deleteUser(id: string): Promise<void>;

  createSession(tokenHash: string, userId: string, expiresAt: Date): Promise<void>;
  findSession(tokenHash: string): Promise<{ userId: string; expiresAt: string } | null>;
  deleteSession(tokenHash: string): Promise<void>;
  deleteUserSessions(userId: string, exceptTokenHash?: string): Promise<void>;
  purgeExpiredSessions(): Promise<void>;

  getPortfolio(userId: string): Promise<{ data: unknown; version: number } | null>;
  /** baseVersion = 0: lần lưu đầu tiên; còn lại phải khớp phiên bản hiện có (chống ghi đè chéo thiết bị). */
  savePortfolio(userId: string, data: unknown, baseVersion: number): Promise<SaveResult>;
}

export const MAX_FAILED_LOGINS = 5;
export const LOCK_MINUTES = 15;
