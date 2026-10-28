import { neon } from '@neondatabase/serverless';
import { LOCK_MINUTES, MAX_FAILED_LOGINS, type NewUser, type Role, type SaveResult, type Status, type Store, type UserRecord } from './store.js';

/** Lỗi cấu hình (thiếu biến môi trường…) – trả 503 kèm hướng dẫn thay vì lỗi 500 mơ hồ. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

type Sql = ReturnType<typeof neon>;
let cached: Sql | null = null;

function db(): Sql {
  if (!cached) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new ConfigError('Máy chủ chưa được cấu hình cơ sở dữ liệu (thiếu biến môi trường DATABASE_URL).');
    cached = neon(url);
  }
  return cached;
}

const iso = (v: unknown): string | null => (v == null ? null : new Date(v as string | number | Date).toISOString());

function mapUser(r: any): UserRecord {
  return {
    id: r.id,
    email: r.email,
    emailCanonical: r.email_canonical,
    displayName: r.display_name,
    passwordHash: r.password_hash,
    role: r.role,
    status: r.status,
    resetRequestHash: r.reset_request_hash ?? null,
    resetRequestedAt: iso(r.reset_requested_at),
    failedLogins: Number(r.failed_logins) || 0,
    lockedUntil: iso(r.locked_until),
    createdAt: iso(r.created_at)!,
    approvedAt: iso(r.approved_at),
  };
}

export function createNeonStore(): Store {
  return {
    async countAdmins() {
      const rows = (await db()`select count(*)::int as n from users where role = 'admin' and status = 'active'`) as any[];
      return Number(rows[0]?.n) || 0;
    },

    async findUserById(id) {
      const rows = (await db()`select * from users where id = ${id}`) as any[];
      return rows[0] ? mapUser(rows[0]) : null;
    },

    async findUserByCanonical(canonical) {
      const rows = (await db()`select * from users where email_canonical = ${canonical}`) as any[];
      return rows[0] ? mapUser(rows[0]) : null;
    },

    async listUsers() {
      const rows = (await db()`select * from users order by created_at asc`) as any[];
      return rows.map(mapUser);
    },

    async createUser(u: NewUser) {
      const approvedAt = u.status === 'active' ? new Date().toISOString() : null;
      try {
        const rows = (await db()`
          insert into users (email, email_canonical, display_name, password_hash, role, status, approved_at)
          values (${u.email}, ${u.emailCanonical}, ${u.displayName}, ${u.passwordHash}, ${u.role}, ${u.status}, ${approvedAt})
          returning *`) as any[];
        return mapUser(rows[0]);
      } catch (e: any) {
        if (e?.code === '23505') return null; // trùng Gmail
        throw e;
      }
    },

    async setStatus(id: string, status: Status) {
      await db()`
        update users
        set status = ${status},
            approved_at = case when ${status}::text = 'active' then now() else approved_at end
        where id = ${id}`;
    },

    async setRole(id: string, role: Role) {
      await db()`update users set role = ${role} where id = ${id}`;
    },

    async setPassword(id, passwordHash) {
      await db()`
        update users
        set password_hash = ${passwordHash}, reset_request_hash = null, reset_requested_at = null,
            failed_logins = 0, locked_until = null
        where id = ${id}`;
    },

    async setResetRequest(id, hash) {
      const at = hash ? new Date().toISOString() : null;
      await db()`update users set reset_request_hash = ${hash}, reset_requested_at = ${at} where id = ${id}`;
    },

    async setDisplayName(id, displayName) {
      await db()`update users set display_name = ${displayName} where id = ${id}`;
    },

    async recordLoginFailure(id) {
      const lockAfter = MAX_FAILED_LOGINS;
      const lockInterval = `${LOCK_MINUTES} minutes`;
      await db()`
        update users
        set failed_logins = failed_logins + 1,
            locked_until = case when failed_logins + 1 >= ${lockAfter}::int
                                then now() + ${lockInterval}::interval
                                else locked_until end
        where id = ${id}`;
    },

    async clearLoginFailures(id) {
      await db()`update users set failed_logins = 0, locked_until = null where id = ${id}`;
    },

    async deleteUser(id) {
      await db()`delete from users where id = ${id}`;
    },

    async createSession(tokenHash, userId, expiresAt) {
      await db()`insert into sessions (token_hash, user_id, expires_at) values (${tokenHash}, ${userId}, ${expiresAt.toISOString()})`;
    },

    async findSession(tokenHash) {
      const rows = (await db()`select user_id, expires_at from sessions where token_hash = ${tokenHash} and expires_at > now()`) as any[];
      return rows[0] ? { userId: rows[0].user_id, expiresAt: iso(rows[0].expires_at)! } : null;
    },

    async deleteSession(tokenHash) {
      await db()`delete from sessions where token_hash = ${tokenHash}`;
    },

    async deleteUserSessions(userId, exceptTokenHash) {
      if (exceptTokenHash) await db()`delete from sessions where user_id = ${userId} and token_hash <> ${exceptTokenHash}`;
      else await db()`delete from sessions where user_id = ${userId}`;
    },

    async purgeExpiredSessions() {
      await db()`delete from sessions where expires_at < now()`;
    },

    async getPortfolio(userId) {
      const rows = (await db()`select data, version from portfolios where user_id = ${userId}`) as any[];
      return rows[0] ? { data: rows[0].data, version: Number(rows[0].version) } : null;
    },

    async savePortfolio(userId, data, baseVersion): Promise<SaveResult> {
      const json = JSON.stringify(data);
      if (baseVersion === 0) {
        const rows = (await db()`
          insert into portfolios (user_id, data, version) values (${userId}, ${json}::jsonb, 1)
          on conflict (user_id) do nothing
          returning version`) as any[];
        if (rows[0]) return { ok: true, version: Number(rows[0].version) };
      } else {
        const rows = (await db()`
          update portfolios
          set data = ${json}::jsonb, version = version + 1, updated_at = now()
          where user_id = ${userId} and version = ${baseVersion}
          returning version`) as any[];
        if (rows[0]) return { ok: true, version: Number(rows[0].version) };
      }
      const cur = (await db()`select version from portfolios where user_id = ${userId}`) as any[];
      return { ok: false, version: Number(cur[0]?.version) || 0 };
    },
  };
}
