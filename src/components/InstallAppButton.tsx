import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, Share, Smartphone } from 'lucide-react';
import { Modal, ModalBody, ModalFooter } from './ui/Modal';

/** Sự kiện của trình duyệt Chrome/Edge/Android: cho phép tự bật hộp thoại "Cài đặt ứng dụng". */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * Trạng thái cài đặt PWA (cùng cách làm với Nhật Ký Giao Dịch):
 * - đã mở ở chế độ ứng dụng (standalone) → không hiện nút;
 * - trình duyệt cho phép cài tự động (Chrome/Edge/Android) → nút "Cài đặt ứng dụng";
 * - còn lại (iPhone Safari, Firefox, Safari máy tính) → nút "Hướng dẫn cài" mở các bước thủ công.
 */
export function useInstallPrompt() {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
    setIsInstalled(standalone);
    setIsIOS(/iphone|ipad|ipod/.test(window.navigator.userAgent.toLowerCase()));

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setPromptEvent(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setIsInstalled(true);
      setPromptEvent(null);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const install = async (): Promise<boolean> => {
    if (!promptEvent) return false;
    await promptEvent.prompt();
    const { outcome } = await promptEvent.userChoice;
    if (outcome === 'accepted') {
      setIsInstalled(true);
      setPromptEvent(null);
      return true;
    }
    return false;
  };

  return { isInstallable: promptEvent !== null, isInstalled, isIOS, install };
}

const STEP_NUM =
  'font-mono-num flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-slate-100 text-xs font-semibold text-slate-900';

/** Nút cài đặt ứng dụng ở thanh bên. `iconOnly` dùng khi thanh bên đang thu gọn. */
export const InstallAppButton: React.FC<{ iconOnly?: boolean }> = ({ iconOnly = false }) => {
  const { isInstallable, isInstalled, isIOS, install } = useInstallPrompt();
  const [showGuide, setShowGuide] = useState(false);

  if (isInstalled) return null;

  const base = `w-full flex items-center rounded-lg text-xs font-medium transition-colors min-h-[40px] ${
    iconOnly ? 'justify-center px-0' : 'justify-between gap-2 px-3'
  }`;

  if (isInstallable) {
    return (
      <button
        type="button"
        data-install-app
        onClick={() => void install()}
        title="Cài đặt ứng dụng (PWA)"
        aria-label="Cài đặt ứng dụng (PWA)"
        className={`${base} bg-accent text-on-accent hover:bg-accent-hover`}
      >
        {!iconOnly && <span className="whitespace-nowrap">Cài đặt ứng dụng (PWA)</span>}
        <Download className="h-4 w-4 shrink-0" />
      </button>
    );
  }

  const label = isIOS ? 'Cài lên iPhone' : 'Hướng dẫn cài iPhone PWA';
  return (
    <>
      <button
        type="button"
        data-install-guide
        onClick={() => setShowGuide(true)}
        title={label}
        aria-label="Hướng dẫn cài iPhone PWA"
        className={`${base} border border-slate-200 bg-white text-slate-900 hover:bg-slate-100`}
      >
        {!iconOnly && <span className="whitespace-nowrap">{label}</span>}
        <Smartphone className="h-4 w-4 shrink-0 text-accent-ink" />
      </button>
      {/* Vẽ ra ngoài thanh bên: thanh bên có transform nên sẽ nhốt hộp thoại "fixed" bên trong nó */}
      {showGuide &&
        createPortal(
          <Modal
            title="Cài đặt lên Màn hình chính iPhone"
            subtitle="Mở nhanh mọi lúc như ứng dụng gốc trên iOS Safari."
            onClose={() => setShowGuide(false)}
          >
            <ModalBody>
              <ol className="space-y-3 text-sm text-slate-900">
                <li className="flex items-start gap-3">
                  <span className={STEP_NUM}>1</span>
                  <span>
                    Mở liên kết ứng dụng này bằng trình duyệt <strong>Safari</strong> trên iPhone.
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <span className={STEP_NUM}>2</span>
                  <span className="flex flex-wrap items-center gap-1">
                    Nhấn vào biểu tượng <Share className="inline h-4 w-4 text-accent-ink" />
                    <strong>Chia sẻ (Share)</strong> ở thanh dưới cùng Safari.
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <span className={STEP_NUM}>3</span>
                  <span>
                    Cuộn xuống và chọn <strong>Thêm vào MH chính (Add to Home Screen)</strong>, sau đó nhấn{' '}
                    <strong>Thêm</strong>.
                  </span>
                </li>
              </ol>
            </ModalBody>
            <ModalFooter>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="min-h-[40px] rounded-lg bg-slate-900 px-5 text-sm font-medium text-white transition-opacity hover:opacity-90"
              >
                Đã hiểu
              </button>
            </ModalFooter>
          </Modal>,
          document.body
        )}
    </>
  );
};
