-- =============================================================================
-- QUẢN LÝ TÀI SẢN VÀ NỢ — CƠ SỞ DỮ LIỆU (Neon / PostgreSQL)
-- Chạy file này MỘT LẦN trong Neon → SQL Editor. An toàn khi chạy lại (idempotent).
-- =============================================================================

-- 1. TÀI KHOẢN NGƯỜI DÙNG
create table if not exists users (
  id                  uuid primary key default gen_random_uuid(),
  email               text        not null,                       -- Gmail đăng nhập, chữ thường
  email_canonical     text        not null unique,                -- Gmail bỏ dấu chấm (a.b@ = ab@) để chống đăng ký trùng
  display_name        text        not null,                       -- tên dùng để chào / hiển thị
  password_hash       text        not null,                       -- scrypt, KHÔNG lưu mật khẩu gốc
  role                text        not null default 'user'    check (role in ('admin', 'user')),
  status              text        not null default 'pending' check (status in ('pending', 'active', 'rejected', 'locked')),
  reset_request_hash  text,                                       -- mật khẩu mới (đã băm) chờ quản trị viên duyệt
  reset_requested_at  timestamptz,
  failed_logins       integer     not null default 0,             -- đếm đăng nhập sai liên tiếp
  locked_until        timestamptz,                                -- khóa tạm sau 5 lần sai
  created_at          timestamptz not null default now(),
  approved_at         timestamptz
);

-- 2. PHIÊN ĐĂNG NHẬP (chỉ lưu bản băm SHA-256 của mã phiên, không lưu mã gốc)
create table if not exists sessions (
  token_hash  text primary key,
  user_id     uuid        not null references users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);
create index if not exists sessions_user_idx    on sessions (user_id);
create index if not exists sessions_expires_idx on sessions (expires_at);

-- 3. DỮ LIỆU TÀI CHÍNH CỦA TỪNG NGƯỜI DÙNG (tài sản, khoản nợ, ví, giao dịch, lịch sử tài sản ròng)
--    Lưu cả danh mục dạng JSONB vì ứng dụng làm việc theo "toàn bộ trạng thái".
--    version tăng sau mỗi lần lưu → phát hiện ghi đè khi mở app trên 2 thiết bị cùng lúc.
create table if not exists portfolios (
  user_id     uuid primary key references users (id) on delete cascade,
  data        jsonb       not null,
  version     integer     not null default 1,
  updated_at  timestamptz not null default now()
);

-- Quản trị viên đầu tiên KHÔNG tạo bằng SQL: đặt biến môi trường ADMIN_EMAIL trên Vercel rồi đăng ký bằng Gmail đó.
