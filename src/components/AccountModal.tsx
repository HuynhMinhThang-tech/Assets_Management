import React, { useState } from 'react';
import { PublicUser, validateDisplayName, validatePassword } from '../utils/auth';
import { api, ApiError } from '../utils/api';
import { Modal, ModalBody, ModalFooter, FieldError } from './ui/Modal';
import { useDialog } from './ui/DialogProvider';

interface AccountModalProps {
  user: PublicUser;
  onClose: () => void;
  /** Cập nhật người dùng đang đăng nhập sau khi đổi tên. */
  onUserChanged: (user: PublicUser) => void;
}

const inputClass =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900';

export const AccountModal: React.FC<AccountModalProps> = ({ user, onClose, onUserChanged }) => {
  const { toast } = useDialog();
  const [displayName, setDisplayName] = useState(user.displayName);
  const [nameError, setNameError] = useState('');

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pwError, setPwError] = useState('');
  const [busy, setBusy] = useState(false);

  const nameChanged = displayName.trim() !== user.displayName;
  const nameValidation = validateDisplayName(displayName);

  const saveName = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nameChanged || nameValidation) return;
    try {
      const res = await api.updateProfile(displayName);
      setNameError('');
      toast('Đã cập nhật tên hiển thị.');
      onUserChanged(res.user);
    } catch (err) {
      setNameError(err instanceof ApiError ? err.message : 'Không thể lưu tên hiển thị.');
    }
  };

  const pwValidation = next ? validatePassword(next, user.email) : '';
  const mismatch = confirm !== '' && confirm !== next ? 'Mật khẩu nhập lại chưa khớp.' : '';
  const canChangePw = !!current && !!next && !pwValidation && next === confirm && !busy;

  const savePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canChangePw) return;
    setBusy(true);
    try {
      await api.changePassword({ current, next });
      setPwError('');
      setCurrent('');
      setNext('');
      setConfirm('');
      toast('Đã đổi mật khẩu. Các thiết bị khác sẽ bị đăng xuất.');
    } catch (err) {
      setPwError(err instanceof ApiError ? err.message : 'Không thể đổi mật khẩu.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Tài khoản của tôi" subtitle={`${user.email} · ${user.role === 'admin' ? 'Quản trị viên' : 'Người dùng'}`} onClose={onClose}>
      <ModalBody className="space-y-6">
        <form onSubmit={saveName} noValidate className="space-y-2">
          <label htmlFor="acc-name" className="block text-xs font-semibold text-slate-700">
            Tên hiển thị
          </label>
          <div className="flex items-start gap-2">
            <div className="flex-1">
              <input
                id="acc-name"
                type="text"
                value={displayName}
                onChange={(e) => {
                  setDisplayName(e.target.value);
                  setNameError('');
                }}
                aria-invalid={nameValidation || nameError ? true : undefined}
                className={inputClass}
              />
              <FieldError>{nameChanged ? nameValidation || nameError : nameError}</FieldError>
            </div>
            <button
              type="submit"
              disabled={!nameChanged || !!nameValidation}
              className="rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-bold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Lưu
            </button>
          </div>
        </form>

        <form onSubmit={savePassword} noValidate className="space-y-3 border-t border-slate-100 pt-5">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">Đổi mật khẩu</h4>
          <div>
            <label htmlFor="acc-cur" className="mb-1 block text-xs font-semibold text-slate-700">
              Mật khẩu hiện tại
            </label>
            <input id="acc-cur" type="password" autoComplete="current-password" value={current} onChange={(e) => { setCurrent(e.target.value); setPwError(''); }} className={inputClass} />
          </div>
          <div>
            <label htmlFor="acc-new" className="mb-1 block text-xs font-semibold text-slate-700">
              Mật khẩu mới
            </label>
            <input id="acc-new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} aria-invalid={pwValidation ? true : undefined} className={inputClass} />
            <FieldError>{pwValidation}</FieldError>
          </div>
          <div>
            <label htmlFor="acc-confirm" className="mb-1 block text-xs font-semibold text-slate-700">
              Nhập lại mật khẩu mới
            </label>
            <input id="acc-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-invalid={mismatch ? true : undefined} className={inputClass} />
            <FieldError>{mismatch}</FieldError>
          </div>
          <FieldError>{pwError}</FieldError>
          <button
            type="submit"
            disabled={!canChangePw}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? 'Đang xử lý…' : 'Đổi mật khẩu'}
          </button>
        </form>
      </ModalBody>
      <ModalFooter>
        <button type="button" onClick={onClose} className="rounded-lg px-4 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100">
          Đóng
        </button>
      </ModalFooter>
    </Modal>
  );
};
