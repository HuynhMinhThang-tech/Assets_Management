import { randomUUID } from 'node:crypto';
import { LOCK_MINUTES, MAX_FAILED_LOGINS, type SaveResult, type Store, type UserRecord } from './store.js';

/** Bản cài đặt Store trong bộ nhớ – chỉ dùng cho kiểm thử, hành vi phản chiếu bản Neon. */
export function createMemoryStore(now: () => Date = () => new Date()): Store & { _dump(): unknown } {
  const users = new Map<string, UserRecord>();
  const sessions = new Map<string, { userId: string; expiresAt: string }>();
  const portfolios = new Map<string, { data: unknown; version: number }>();
  const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

  return {
    async countAdmins() {
      return [...users.values()].filter((u) => u.role === 'admin' && u.status === 'active').length;
    },
    async findUserById(id) {
      const u = users.get(id);
      return u ? clone(u) : null;
    },
    async findUserByCanonical(c) {
      const u = [...users.values()].find((x) => x.emailCanonical === c);
      return u ? clone(u) : null;
    },
    async listUsers() {
      return [...users.values()].map(clone).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },
    async createUser(input) {
      if ([...users.values()].some((u) => u.emailCanonical === input.emailCanonical)) return null;
      const rec: UserRecord = {
        id: randomUUID(),
        ...input,
        resetRequestHash: null,
        resetRequestedAt: null,
        failedLogins: 0,
        lockedUntil: null,
        createdAt: now().toISOString(),
        approvedAt: input.status === 'active' ? now().toISOString() : null,
      };
      users.set(rec.id, rec);
      return clone(rec);
    },
    async setStatus(id, status) {
      const u = users.get(id);
      if (!u) return;
      u.status = status;
      if (status === 'active') u.approvedAt = now().toISOString();
    },
    async setRole(id, role) {
      const u = users.get(id);
      if (u) u.role = role;
    },
    async setPassword(id, hash) {
      const u = users.get(id);
      if (!u) return;
      Object.assign(u, { passwordHash: hash, resetRequestHash: null, resetRequestedAt: null, failedLogins: 0, lockedUntil: null });
    },
    async setResetRequest(id, hash) {
      const u = users.get(id);
      if (!u) return;
      u.resetRequestHash = hash;
      u.resetRequestedAt = hash ? now().toISOString() : null;
    },
    async setDisplayName(id, name) {
      const u = users.get(id);
      if (u) u.displayName = name;
    },
    async recordLoginFailure(id) {
      const u = users.get(id);
      if (!u) return;
      u.failedLogins += 1;
      if (u.failedLogins >= MAX_FAILED_LOGINS) u.lockedUntil = new Date(now().getTime() + LOCK_MINUTES * 60_000).toISOString();
    },
    async clearLoginFailures(id) {
      const u = users.get(id);
      if (u) Object.assign(u, { failedLogins: 0, lockedUntil: null });
    },
    async deleteUser(id) {
      users.delete(id);
      portfolios.delete(id);
      for (const [h, s] of sessions) if (s.userId === id) sessions.delete(h);
    },
    async createSession(tokenHash, userId, expiresAt) {
      sessions.set(tokenHash, { userId, expiresAt: expiresAt.toISOString() });
    },
    async findSession(tokenHash) {
      const s = sessions.get(tokenHash);
      return s && new Date(s.expiresAt) > now() ? { ...s } : null;
    },
    async deleteSession(tokenHash) {
      sessions.delete(tokenHash);
    },
    async deleteUserSessions(userId, except) {
      for (const [h, s] of sessions) if (s.userId === userId && h !== except) sessions.delete(h);
    },
    async purgeExpiredSessions() {
      for (const [h, s] of sessions) if (new Date(s.expiresAt) <= now()) sessions.delete(h);
    },
    async getPortfolio(userId) {
      const p = portfolios.get(userId);
      return p ? clone(p) : null;
    },
    async savePortfolio(userId, data, baseVersion): Promise<SaveResult> {
      const cur = portfolios.get(userId);
      if (baseVersion === 0 ? !cur : cur && cur.version === baseVersion) {
        const version = (cur?.version ?? 0) + 1;
        portfolios.set(userId, { data: clone(data), version });
        return { ok: true, version };
      }
      return { ok: false, version: cur?.version ?? 0 };
    },
    _dump() {
      return { users: [...users.values()], sessions: [...sessions.keys()], portfolios: [...portfolios.keys()] };
    },
  };
}
