import { header, parseCookies, readJson, sendJson, serializeCookie, type ApiRequest, type ApiResponse } from './http.js';
import { hashPassword, hashToken, burnPasswordTime, newSessionToken, verifyPassword } from './passwords.js';
import { LOCK_MINUTES, MAX_FAILED_LOGINS, type Store, type UserRecord } from './store.js';
import {
  GMAIL_SUFFIX,
  canonicalEmail,
  isPortfolioShape,
  isUuid,
  normalizeEmail,
  validateDisplayName,
  validateEmail,
  validatePassword,
} from './validate.js';

export interface AppConfig {
  /** Gmail được tự động làm quản trị viên khi đăng ký (biến môi trường ADMIN_EMAIL, cách nhau bằng dấu phẩy). */
  adminEmails: string[];
  /** Đặt cờ Secure cho cookie (true khi chạy HTTPS / production). */
  secureCookies: boolean;
  now?: () => Date;
}

export const SESSION_COOKIE = 'fintrack_session';
const REMEMBER_DAYS = 30;
const SHORT_SESSION_HOURS = 24;
const MAX_PORTFOLIO_BYTES = 3_000_000;

class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string, public extra?: Record<string, unknown>) {
    super(message);
  }
}

const STATUS_MESSAGES: Record<string, string> = {
  pending: 'Tài khoản của bạn đang chờ quản trị viên phê duyệt. Vui lòng quay lại sau khi được duyệt.',
  rejected: 'Đăng ký của bạn đã bị quản trị viên từ chối.',
  locked: 'Tài khoản đã bị khóa. Hãy liên hệ quản trị viên.',
};

const publicUser = (u: UserRecord) => ({ id: u.id, email: u.email, displayName: u.displayName, role: u.role, status: u.status });
const adminAccount = (u: UserRecord) => ({
  ...publicUser(u),
  createdAt: u.createdAt,
  approvedAt: u.approvedAt,
  hasResetRequest: !!u.resetRequestHash,
  resetRequestedAt: u.resetRequestedAt,
});

export function createApp(store: Store, config: AppConfig) {
  const now = config.now ?? (() => new Date());
  const adminEmails = config.adminEmails.map((e) => canonicalEmail(e)).filter(Boolean);

  function startSession(res: ApiResponse, user: UserRecord, remember: boolean) {
    const token = newSessionToken();
    const ttlMs = remember ? REMEMBER_DAYS * 86_400_000 : SHORT_SESSION_HOURS * 3_600_000;
    const expires = new Date(now().getTime() + ttlMs);
    return store.createSession(hashToken(token), user.id, expires).then(() => {
      res.setHeader(
        'Set-Cookie',
        serializeCookie(SESSION_COOKIE, token, {
          secure: config.secureCookies,
          // "Ghi nhớ" → cookie sống 30 ngày; không → cookie phiên (tắt trình duyệt là mất), máy chủ vẫn hết hạn sau 24 giờ
          maxAgeSeconds: remember ? REMEMBER_DAYS * 86_400 : undefined,
        })
      );
    });
  }

  const clearCookie = (res: ApiResponse) =>
    res.setHeader('Set-Cookie', serializeCookie(SESSION_COOKIE, '', { secure: config.secureCookies, maxAgeSeconds: 0 }));

  async function currentUser(req: ApiRequest): Promise<{ user: UserRecord; tokenHash: string } | null> {
    const token = parseCookies(header(req, 'cookie'))[SESSION_COOKIE];
    if (!token) return null;
    const tokenHash = hashToken(token);
    const session = await store.findSession(tokenHash);
    if (!session || new Date(session.expiresAt) <= now()) return null;
    const user = await store.findUserById(session.userId);
    if (!user || user.status !== 'active') return null;
    return { user, tokenHash };
  }

  async function requireUser(req: ApiRequest) {
    const cur = await currentUser(req);
    if (!cur) throw new HttpError(401, 'Bạn chưa đăng nhập hoặc phiên đã hết hạn.', 'unauthenticated');
    return cur;
  }

  async function requireAdmin(req: ApiRequest) {
    const cur = await requireUser(req);
    if (cur.user.role !== 'admin') throw new HttpError(403, 'Bạn không có quyền quản trị.', 'forbidden');
    return cur;
  }

  /** Chống CSRF: yêu cầu thay đổi dữ liệu phải cùng nguồn (Origin) và là JSON. */
  function guardMutation(req: ApiRequest) {
    const origin = header(req, 'origin');
    if (origin) {
      const host = header(req, 'x-forwarded-host') || header(req, 'host');
      let originHost = '';
      try {
        originHost = new URL(origin).host;
      } catch {
        /* để trống → bị từ chối */
      }
      if (!host || originHost !== host) throw new HttpError(403, 'Yêu cầu bị từ chối (khác nguồn).', 'bad_origin');
    }
    if (!header(req, 'content-type').toLowerCase().includes('application/json'))
      throw new HttpError(415, 'Yêu cầu phải gửi dưới dạng JSON.', 'unsupported_media_type');
  }

  const str = (v: unknown) => (typeof v === 'string' ? v : '');

  // ---------------------------------------------------------------------------
  // Xác thực
  // ---------------------------------------------------------------------------
  async function register(req: ApiRequest, res: ApiResponse) {
    const body = readJson(req);
    const displayName = str(body.displayName).trim();
    const email = normalizeEmail(str(body.email));
    const password = str(body.password);
    const err = validateDisplayName(displayName) || validateEmail(email) || validatePassword(password, email);
    if (err) throw new HttpError(400, err, 'invalid_input');

    const canon = canonicalEmail(email);
    const isAdmin = adminEmails.includes(canon);
    if (!isAdmin && adminEmails.length === 0 && (await store.countAdmins()) === 0)
      throw new HttpError(
        503,
        'Hệ thống chưa có quản trị viên: người triển khai cần đặt biến môi trường ADMIN_EMAIL rồi đăng ký bằng Gmail đó trước.',
        'not_configured'
      );

    const passwordHash = await hashPassword(password);
    const created = await store.createUser({
      email,
      emailCanonical: canon,
      displayName,
      passwordHash,
      role: isAdmin ? 'admin' : 'user',
      status: isAdmin ? 'active' : 'pending',
    });
    if (!created) throw new HttpError(409, 'Gmail này đã được đăng ký.', 'email_taken');

    if (created.status === 'active') {
      await startSession(res, created, true);
      return sendJson(res, 201, { status: 'active', user: publicUser(created) });
    }
    return sendJson(res, 201, { status: 'pending' });
  }

  async function login(req: ApiRequest, res: ApiResponse) {
    const body = readJson(req);
    const email = normalizeEmail(str(body.email));
    const password = str(body.password);
    const remember = body.remember !== false;
    if (!email || !password) throw new HttpError(400, 'Nhập Gmail và mật khẩu.', 'invalid_input');

    const user = email.endsWith(GMAIL_SUFFIX) ? await store.findUserByCanonical(canonicalEmail(email)) : null;
    if (!user) {
      await burnPasswordTime(password);
      throw new HttpError(401, 'Sai Gmail hoặc mật khẩu.', 'invalid_credentials');
    }

    const t = now();
    if (user.lockedUntil && new Date(user.lockedUntil) > t) {
      const mins = Math.max(1, Math.ceil((new Date(user.lockedUntil).getTime() - t.getTime()) / 60_000));
      throw new HttpError(429, `Đăng nhập sai quá nhiều lần. Thử lại sau ${mins} phút.`, 'throttled');
    }
    if (user.failedLogins >= MAX_FAILED_LOGINS) await store.clearLoginFailures(user.id); // khóa tạm đã hết hạn

    if (!(await verifyPassword(password, user.passwordHash))) {
      await store.recordLoginFailure(user.id);
      throw new HttpError(401, 'Sai Gmail hoặc mật khẩu.', 'invalid_credentials');
    }
    if (user.failedLogins > 0) await store.clearLoginFailures(user.id);

    // Chỉ lộ trạng thái tài khoản sau khi đã nhập ĐÚNG mật khẩu
    if (user.status !== 'active') throw new HttpError(403, STATUS_MESSAGES[user.status] ?? 'Tài khoản chưa được kích hoạt.', user.status);

    void store.purgeExpiredSessions().catch(() => undefined);
    await startSession(res, user, remember);
    return sendJson(res, 200, { user: publicUser(user) });
  }

  async function logout(req: ApiRequest, res: ApiResponse) {
    const token = parseCookies(header(req, 'cookie'))[SESSION_COOKIE];
    if (token) await store.deleteSession(hashToken(token));
    clearCookie(res);
    return sendJson(res, 200, { ok: true });
  }

  async function me(req: ApiRequest, res: ApiResponse) {
    const { user } = await requireUser(req);
    return sendJson(res, 200, { user: publicUser(user) });
  }

  /** Quên mật khẩu: lưu mật khẩu mới (đã băm) chờ quản trị viên duyệt. Luôn trả kết quả giống nhau. */
  async function forgot(req: ApiRequest, res: ApiResponse) {
    const body = readJson(req);
    const email = normalizeEmail(str(body.email));
    const password = str(body.password);
    const err = validateEmail(email) || validatePassword(password, email);
    if (err) throw new HttpError(400, err, 'invalid_input');
    const hash = await hashPassword(password);
    const user = await store.findUserByCanonical(canonicalEmail(email));
    if (user && user.status === 'active') await store.setResetRequest(user.id, hash);
    return sendJson(res, 200, { ok: true });
  }

  async function changePassword(req: ApiRequest, res: ApiResponse) {
    const { user, tokenHash } = await requireUser(req);
    const body = readJson(req);
    const current = str(body.current);
    const next = str(body.next);
    if (!(await verifyPassword(current, user.passwordHash))) throw new HttpError(400, 'Mật khẩu hiện tại không đúng.', 'wrong_password');
    const err = validatePassword(next, user.email);
    if (err) throw new HttpError(400, err, 'invalid_input');
    await store.setPassword(user.id, await hashPassword(next));
    await store.deleteUserSessions(user.id, tokenHash); // đăng xuất các thiết bị khác
    return sendJson(res, 200, { ok: true });
  }

  async function updateProfile(req: ApiRequest, res: ApiResponse) {
    const { user } = await requireUser(req);
    const displayName = str(readJson(req).displayName).trim();
    const err = validateDisplayName(displayName);
    if (err) throw new HttpError(400, err, 'invalid_input');
    await store.setDisplayName(user.id, displayName);
    return sendJson(res, 200, { user: publicUser({ ...user, displayName }) });
  }

  // ---------------------------------------------------------------------------
  // Quản trị
  // ---------------------------------------------------------------------------
  async function listAccounts(req: ApiRequest, res: ApiResponse) {
    await requireAdmin(req);
    return sendJson(res, 200, { accounts: (await store.listUsers()).map(adminAccount) });
  }

  async function adminAction(req: ApiRequest, res: ApiResponse, targetId: string, action: string) {
    const { user: actor } = await requireAdmin(req);
    if (!isUuid(targetId)) throw new HttpError(404, 'Không tìm thấy tài khoản.', 'not_found');
    const target = await store.findUserById(targetId);
    if (!target) throw new HttpError(404, 'Không tìm thấy tài khoản.', 'not_found');
    const self = target.id === actor.id;
    const bad = (msg: string) => new HttpError(400, msg, 'invalid_action');

    switch (action) {
      case 'approve':
        if (target.status === 'active') throw bad('Tài khoản đã được kích hoạt.');
        await store.setStatus(target.id, 'active');
        break;
      case 'reject':
        if (target.status !== 'pending') throw bad('Chỉ từ chối được đăng ký đang chờ duyệt.');
        await store.setStatus(target.id, 'rejected');
        break;
      case 'lock':
        if (self) throw bad('Bạn không thể tự khóa tài khoản của mình.');
        if (target.status !== 'active') throw bad('Tài khoản không ở trạng thái hoạt động.');
        await store.setStatus(target.id, 'locked');
        await store.setResetRequest(target.id, null);
        await store.deleteUserSessions(target.id);
        break;
      case 'promote':
      case 'demote':
        if (self) throw bad('Bạn không thể đổi quyền của chính mình.');
        if (target.status !== 'active') throw bad('Chỉ đổi quyền cho tài khoản đang hoạt động.');
        await store.setRole(target.id, action === 'promote' ? 'admin' : 'user');
        break;
      case 'reset-approve':
        if (!target.resetRequestHash) throw bad('Không có yêu cầu đặt lại mật khẩu.');
        if (self) throw bad('Yêu cầu của chính bạn cần một quản trị viên khác duyệt.');
        await store.setPassword(target.id, target.resetRequestHash);
        await store.deleteUserSessions(target.id);
        break;
      case 'reset-deny':
        if (!target.resetRequestHash) throw bad('Không có yêu cầu đặt lại mật khẩu.');
        await store.setResetRequest(target.id, null);
        break;
      case 'delete':
        if (self) throw bad('Bạn không thể tự xóa tài khoản của mình.');
        if (target.status === 'active' || target.status === 'pending') throw bad('Hãy khóa hoặc từ chối tài khoản trước khi xóa.');
        await store.deleteUser(target.id);
        break;
      default:
        throw new HttpError(404, 'Thao tác không tồn tại.', 'not_found');
    }
    return sendJson(res, 200, { ok: true });
  }

  // ---------------------------------------------------------------------------
  // Dữ liệu danh mục của từng người dùng
  // ---------------------------------------------------------------------------
  async function getPortfolio(req: ApiRequest, res: ApiResponse) {
    const { user } = await requireUser(req);
    const p = await store.getPortfolio(user.id);
    return sendJson(res, 200, { data: p?.data ?? null, version: p?.version ?? 0 });
  }

  async function putPortfolio(req: ApiRequest, res: ApiResponse) {
    const { user } = await requireUser(req);
    const body = readJson(req);
    const baseVersion = body.baseVersion;
    if (typeof baseVersion !== 'number' || !Number.isInteger(baseVersion) || baseVersion < 0)
      throw new HttpError(400, 'baseVersion không hợp lệ.', 'invalid_input');
    if (!isPortfolioShape(body.data)) throw new HttpError(400, 'Dữ liệu danh mục không đúng cấu trúc.', 'invalid_input');
    if (JSON.stringify(body.data).length > MAX_PORTFOLIO_BYTES) throw new HttpError(413, 'Dữ liệu quá lớn.', 'too_large');
    const result = await store.savePortfolio(user.id, body.data, baseVersion);
    if (!result.ok)
      throw new HttpError(409, 'Dữ liệu đã được cập nhật từ nơi khác.', 'conflict', { version: result.version });
    return sendJson(res, 200, { version: result.version });
  }

  // ---------------------------------------------------------------------------
  // Định tuyến
  // ---------------------------------------------------------------------------
  async function route(req: ApiRequest, res: ApiResponse) {
    const method = (req.method ?? 'GET').toUpperCase();
    const path = (new URL(req.url ?? '/', 'http://localhost').pathname.replace(/\/+$/, '') || '/').toLowerCase();

    if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') guardMutation(req);

    if (path === '/api/health' && method === 'GET') return sendJson(res, 200, { ok: true });

    if (path === '/api/auth/register' && method === 'POST') return register(req, res);
    if (path === '/api/auth/login' && method === 'POST') return login(req, res);
    if (path === '/api/auth/logout' && method === 'POST') return logout(req, res);
    if (path === '/api/auth/me' && method === 'GET') return me(req, res);
    if (path === '/api/auth/forgot' && method === 'POST') return forgot(req, res);
    if (path === '/api/auth/password' && method === 'POST') return changePassword(req, res);
    if (path === '/api/auth/profile' && method === 'PATCH') return updateProfile(req, res);

    if (path === '/api/admin/accounts' && method === 'GET') return listAccounts(req, res);
    const m = path.match(/^\/api\/admin\/accounts\/([^/]+)\/([a-z-]+)$/);
    if (m && method === 'POST') return adminAction(req, res, m[1], m[2]);

    if (path === '/api/portfolio' && method === 'GET') return getPortfolio(req, res);
    if (path === '/api/portfolio' && method === 'PUT') return putPortfolio(req, res);

    throw new HttpError(404, 'Không tìm thấy.', 'not_found');
  }

  return async function handler(req: ApiRequest, res: ApiResponse) {
    try {
      await route(req, res);
    } catch (e: any) {
      if (e instanceof HttpError) {
        return sendJson(res, e.status, { error: e.message, code: e.code, ...(e.extra ?? {}) });
      }
      if (e?.name === 'ConfigError') return sendJson(res, 503, { error: e.message, code: 'not_configured' });
      console.error('[api] lỗi không mong đợi:', e);
      return sendJson(res, 500, { error: 'Lỗi máy chủ. Vui lòng thử lại sau.', code: 'server_error' });
    }
  };
}

export { LOCK_MINUTES };
