/** Giới hạn dùng chung cho mọi ô nhập tiền / lãi suất / kỳ hạn. */

/** Trần số tiền một ô nhập (~1.000 nghìn tỷ ₫) – tránh tràn số khi cộng dồn và lỗi làm tròn số thực. */
export const MAX_MONEY = 999_999_999_999_999;
/** Lãi suất tối đa chấp nhận (%/năm). */
export const MAX_RATE = 100;
/** Kỳ hạn vay tối đa (tháng) = 50 năm. */
export const MAX_TENOR_MONTHS = 600;
