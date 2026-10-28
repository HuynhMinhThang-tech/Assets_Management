import type { UserFinancialState } from '../types/finance';

export type SyncStatus = 'idle' | 'saving' | 'saved' | 'error';
export type ConflictChoice = 'use_server' | 'overwrite';

export interface SyncerDeps {
  save: (data: UserFinancialState, baseVersion: number, opts?: { keepalive?: boolean }) => Promise<{ version: number }>;
  /** Tải lại bản mới nhất trên máy chủ (đã chuẩn hóa). */
  loadServer: () => Promise<{ data: UserFinancialState | null; version: number }>;
  /** Hỏi người dùng khi máy chủ có bản mới hơn từ thiết bị khác. */
  onConflict: () => Promise<ConflictChoice>;
  onReplace: (state: UserFinancialState, version: number) => void;
  onStatus: (status: SyncStatus) => void;
  /** Phiên đăng nhập hết hạn (401). */
  onUnauthorized?: () => void;
  delayMs?: number;
  retryMs?: number;
}

/** Ngưỡng của fetch keepalive (64 KB) – lớn hơn thì không gửi được khi đóng tab. */
const KEEPALIVE_LIMIT = 60_000;

/**
 * Tự lưu danh mục lên máy chủ: gom thay đổi (debounce), chỉ một yêu cầu lưu tại một thời điểm,
 * tự thử lại khi mất mạng, và xử lý xung đột khi mở app trên nhiều thiết bị.
 * Không phụ thuộc React nên kiểm thử được độc lập.
 */
export class PortfolioSyncer {
  private version: number;
  private savedJson: string | null;
  private latest: UserFinancialState | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private saving = false;
  private again = false;
  private active = false;
  private readonly delay: number;
  private readonly retry: number;

  constructor(private deps: SyncerDeps, initialVersion: number, initialSavedJson: string | null) {
    this.version = initialVersion;
    this.savedJson = initialSavedJson;
    this.delay = deps.delayMs ?? 800;
    this.retry = deps.retryMs ?? 5000;
  }

  start() {
    this.active = true;
    if (this.latest) this.schedule(this.delay);
  }

  stop() {
    this.active = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Gọi mỗi khi trạng thái thay đổi. */
  update(state: UserFinancialState) {
    this.latest = state;
    if (this.active) this.schedule(this.delay);
  }

  /** Lưu ngay (dùng khi người dùng rời trang). Chỉ gửi nếu còn thay đổi chưa lưu. */
  flushOnLeave() {
    if (!this.active || !this.latest || this.saving) return;
    const json = JSON.stringify(this.latest);
    if (json === this.savedJson) return;
    void this.run(json.length < KEEPALIVE_LIMIT);
  }

  isDirty() {
    return !!this.latest && JSON.stringify(this.latest) !== this.savedJson;
  }

  private schedule(ms: number) {
    if (!this.active) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.run(false), ms);
  }

  private async run(keepalive: boolean) {
    if (!this.active) return;
    if (this.saving) {
      this.again = true;
      return;
    }
    const state = this.latest;
    if (!state) return;
    const json = JSON.stringify(state);
    if (json === this.savedJson) return;

    this.saving = true;
    this.deps.onStatus('saving');
    let retryAfter: number | null = null;
    try {
      const { version } = await this.deps.save(state, this.version, keepalive ? { keepalive: true } : undefined);
      this.version = version;
      this.savedJson = json;
      this.deps.onStatus('saved');
    } catch (e: any) {
      if (e?.status === 409) {
        const choice = await this.deps.onConflict();
        if (choice === 'use_server') {
          const server = await this.deps.loadServer().catch(() => null);
          if (server) {
            this.version = server.version;
            if (server.data) {
              this.latest = server.data; // bản máy chủ trở thành bản hiện tại → không còn "thay đổi chưa lưu"
              this.savedJson = JSON.stringify(server.data);
              this.deps.onReplace(server.data, server.version);
            }
            this.deps.onStatus('saved');
          } else {
            this.deps.onStatus('error');
            retryAfter = this.retry;
          }
        } else {
          // Giữ bản của người dùng: ghi đè lên phiên bản hiện có trên máy chủ
          this.version = typeof e.data?.version === 'number' ? e.data.version : this.version;
          this.again = true;
        }
      } else if (e?.status === 401) {
        this.deps.onStatus('error');
        this.stop(); // hết phiên: dừng hẳn, không gửi lại liên tục
        this.deps.onUnauthorized?.();
      } else {
        this.deps.onStatus('error');
        retryAfter = this.retry;
      }
    } finally {
      this.saving = false;
    }

    if (retryAfter !== null) this.schedule(retryAfter);
    else if (this.again) {
      this.again = false;
      this.schedule(0);
    } else if (this.isDirty()) this.schedule(this.delay);
  }
}
