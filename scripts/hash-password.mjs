#!/usr/bin/env node
/**
 * Tạo chuỗi băm mật khẩu (cùng định dạng với máy chủ) để khôi phục tài khoản quản trị khi quên mật khẩu.
 *
 *   node scripts/hash-password.mjs "MatKhauMoi123"
 *
 * Rồi dán kết quả vào Neon → SQL Editor:
 *   update users set password_hash = '<chuỗi vừa in ra>', failed_logins = 0, locked_until = null
 *   where email_canonical = 'tenban@gmail.com';   -- Gmail viết thường, bỏ dấu chấm
 */
import { randomBytes, scrypt } from 'node:crypto';

const password = process.argv[2];
if (!password || password.length < 8) {
  console.error('Cách dùng: node scripts/hash-password.mjs "mật-khẩu-ít-nhất-8-ký-tự"');
  process.exit(1);
}
const N = 16384, R = 8, P = 1, KEYLEN = 64;
const salt = randomBytes(16);
scrypt(password, salt, KEYLEN, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 }, (err, key) => {
  if (err) throw err;
  console.log(`scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`);
});
