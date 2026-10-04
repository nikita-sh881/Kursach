import { useState, type FormEvent } from 'react';
import { api, errorMessage, setToken } from './api';
import type { User } from './types';
import { Modal, ErrorBox } from './ui';

export default function AuthModal({ mode, onClose, onSuccess }: { mode: 'login' | 'register'; onClose: () => void; onSuccess: (u: User) => void }) {
  const [tab, setTab] = useState(mode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault(); setError('');
    if (tab === 'register' && password !== confirm) { setError('Пароли не совпадают.'); return; }
    setBusy(true);
    let registered = false;
    try {
      if (tab === 'register') { await api('/auth/register', { method: 'POST', body: { email, password } }); registered = true; }
      const result = await api<{ access_token: string }>('/auth/login', { method: 'POST', body: { email, password } });
      setToken(result.access_token);
      const u = await api<User>('/auth/me');
      onSuccess(u);
    } catch (err) {
      setToken('');
      if (registered) { setTab('login'); setError('Аккаунт создан. ' + errorMessage(err)); }
      else setError(errorMessage(err));
    } finally { setBusy(false); }
  }
  return <Modal title={tab === 'login' ? 'Рады видеть вас снова' : 'Ваша следующая глава'} onClose={onClose}>
    <p className="muted">{tab === 'login' ? 'Войдите, чтобы управлять бронированиями и находить новые книги.' : 'Создайте аккаунт, чтобы бронировать книги и получать подборки по вашим интересам.'}</p>
    <div className="segmented"><button className={tab === 'login' ? 'selected' : ''} disabled={busy} onClick={() => { setTab('login'); setError(''); }}>Вход</button><button className={tab === 'register' ? 'selected' : ''} disabled={busy} onClick={() => { setTab('register'); setError(''); }}>Регистрация</button></div>
    <form onSubmit={submit} className="form-stack">
      <label>Электронная почта<input autoFocus type="email" autoComplete="email" required maxLength={254} value={email} onChange={e => setEmail(e.target.value)} placeholder="reader@example.com" /></label>
      <label>Пароль<input aria-label="Пароль" aria-describedby="password-hint" type="password" autoComplete={tab === 'login' ? 'current-password' : 'new-password'} required minLength={12} maxLength={128} value={password} onChange={e => setPassword(e.target.value)} /><span className="field-hint" id="password-hint">От 12 до 128 символов</span></label>
      {tab === 'register' && <label>Повторите пароль<input type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={confirm} onChange={e => setConfirm(e.target.value)} /></label>}
      {error && <ErrorBox text={error} />}
      <button className="button primary" disabled={busy}>{busy ? 'Подождите…' : tab === 'login' ? 'Войти в библиотеку' : 'Создать аккаунт'}</button>
    </form>
  </Modal>;
}
