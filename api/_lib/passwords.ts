import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

/**
 * Băm mật khẩu bằng scrypt (có sẵn trong Node, không cần thư viện ngoài).
 * Định dạng lưu: scrypt$N$r$p$<muối base64>$<khóa base64>
 */
/** Mức băm mục tiêu: N = 2^17 (khuyến nghị hiện nay, cần ~128 MB bộ nhớ mỗi lần băm). Mật khẩu cũ băm với N nhỏ hơn được băm lại khi đăng nhập thành công. */
export const TARGET_N = 131072;
const R = 8;
const P = 1;
const KEYLEN = 64;
const MAXMEM = 256 * 1024 * 1024;

function derive(password: string, salt: Buffer, n: number, r: number, p: number, keylen: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, { N: n, r, p, maxmem: MAXMEM }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export async function hashPassword(password: string, n: number = TARGET_N): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, n, R, P, KEYLEN);
  return `scrypt$${n}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

/** Băm này dùng N thấp hơn mức mục tiêu (hoặc định dạng cũ) → nên băm lại khi người dùng vừa đăng nhập đúng mật khẩu. */
export function passwordNeedsRehash(stored: string, targetN: number = TARGET_N): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const n = Number(parts[1]);
  return Number.isFinite(n) && n < targetN;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, keyB64] = parts;
  const expected = Buffer.from(keyB64, 'base64');
  if (!expected.length) return false;
  try {
    const actual = await derive(password, Buffer.from(saltB64, 'base64'), Number(n), Number(r), Number(p), expected.length);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

const dummies = new Map<number, Promise<string>>();
/** Băm giả: khi không tìm thấy tài khoản vẫn tốn thời gian như khi sai mật khẩu → không lộ Gmail nào tồn tại. */
export function burnPasswordTime(password: string, n: number = TARGET_N): Promise<boolean> {
  let d = dummies.get(n);
  if (!d) {
    d = hashPassword('fintrack-dummy-password', n);
    dummies.set(n, d);
  }
  return d.then((h) => verifyPassword(password, h));
}

export const newSessionToken = () => randomBytes(32).toString('base64url');
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
