import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage, hasToken, setToken } from './api';
import type { Book, User } from './types';
import { Icon, Loading, Empty } from './ui';
import Catalog from './Catalog';
import Account from './Account';
import Staff from './Staff';
import Admin, { roleNames } from './Admin';
import AuthModal from './AuthModal';
import BookModal from './BookModal';

function route() { const value = location.hash.slice(1); return ['account', 'staff', 'admin'].includes(value) ? value : 'catalog'; }
export default function App() {
  const [view, setView] = useState(route);
  const [user, setUser] = useState<User | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [auth, setAuth] = useState<'login' | 'register' | null>(null);
  const [book, setBook] = useState<Book | null>(null);
  const [nextBook, setNextBook] = useState<Book | null>(null);
  const [toast, setToast] = useState('');
  const [revision, setRevision] = useState(0);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const notify = useCallback((message: string) => setToast(message), []);
  useEffect(() => {
    const change = () => { if (location.hash === '#main' || location.hash === '#collection') return; setView(route()); window.scrollTo({ top: 0 }); };
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  useEffect(() => {
    let active = true;
    if (hasToken()) api<User>('/auth/me').then(u => { if (active) setUser(u); }).catch(err => { if (active) notify(errorMessage(err)); }).finally(() => { if (active) setSessionLoading(false); });
    else setSessionLoading(false);
    const expire = () => { setUser(null); setBook(null); setAuth('login'); notify('Сессия завершилась. Войдите снова.'); };
    window.addEventListener('session-expired', expire);
    return () => { active = false; window.removeEventListener('session-expired', expire); };
  }, [notify]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 7000); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => { document.title = `${view === 'account' ? 'Личный кабинет' : view === 'staff' ? 'Управление библиотекой' : view === 'admin' ? 'Пользователи' : 'Каталог книг'} — Лист`; }, [view]);
  async function logout() {
    setLogoutBusy(true);
    try { await api('/auth/logout', { method: 'POST' }); setToken(''); setUser(null); location.hash = 'catalog'; notify('Вы вышли из аккаунта.'); }
    catch (err) { notify(errorMessage(err)); }
    finally { setLogoutBusy(false); }
  }
  function signedIn(u: User) { setUser(u); setAuth(null); notify('Добро пожаловать в библиотеку.'); if (nextBook) { setBook(nextBook); setNextBook(null); } }
  const staff = user?.role === 'staff' || user?.role === 'admin';
  return <><a className="skip-link" href="#main">К содержимому</a><header className="site-header"><div className="header-inner"><a className="brand" href="#catalog" aria-label="Лист — главная"><span className="brand-icon"><Icon name="book" size={25} /></span><span>лист<span className="brand-caption">библиотека</span></span></a><nav aria-label="Основная навигация"><a href="#catalog" className={view === 'catalog' ? 'active' : ''}>Каталог</a><a href="#account" className={view === 'account' ? 'active' : ''}>Мои книги</a>{staff && <a href="#staff" className={view === 'staff' ? 'active' : ''}>Управление</a>}{user?.role === 'admin' && <a href="#admin" className={view === 'admin' ? 'active' : ''}>Пользователи</a>}</nav><div className="header-actions">{sessionLoading ? <span className="spinner" /> : user ? <><a className="user-link" href="#account" title={user.email}><span className="avatar">{user.email[0].toUpperCase()}</span><span className="user-role">{roleNames[user.role]}</span></a><button className="text-button" disabled={logoutBusy} onClick={logout}>{logoutBusy ? 'Выходим…' : 'Выйти'}</button></> : <><button className="text-button" onClick={() => setAuth('login')}>Войти</button><button className="button primary small-button" onClick={() => setAuth('register')}>Регистрация<Icon name="arrow" size={16} /></button></>}</div></div></header>
    <main id="main" className="main-container" tabIndex={-1}>
      {view === 'catalog' && <Catalog onOpen={setBook} revision={revision} />}
      {view !== 'catalog' && sessionLoading && <Loading />}
      {view !== 'catalog' && !sessionLoading && !user && <div className="page-content"><Empty title="Ваши книги — в личном кабинете" text="Войдите или зарегистрируйтесь, чтобы бронировать книги и получать нейросетевые подборки."><div className="modal-actions"><button className="button primary" onClick={() => setAuth('login')}>Войти</button><button className="button secondary" onClick={() => setAuth('register')}>Создать аккаунт</button></div></Empty></div>}
      {view === 'account' && user && <Account key={user.id} user={user} onOpen={setBook} notify={notify} revision={revision} />}
      {view === 'staff' && staff && <Staff notify={notify} onChanged={() => setRevision(v => v + 1)} />}
      {view === 'admin' && user?.role === 'admin' && <Admin current={user} notify={notify} onSelfChanged={() => { setToken(''); setUser(null); setAuth('login'); }} />}
      {user && ((view === 'staff' && !staff) || (view === 'admin' && user.role !== 'admin')) && <Empty title="Доступ ограничен" text="Этот раздел доступен сотрудникам с соответствующими правами."><a className="button secondary" href="#catalog">Открыть каталог</a></Empty>}
    </main>
    <footer className="site-footer"><div><a className="footer-brand" href="#catalog"><Icon name="book" size={20} />лист</a><p>Место для ваших следующих открытий.</p></div><span>Читайте в своём ритме.</span></footer>
    {toast && <div className="toast" role="status"><Icon name="check" size={20} /><span>{toast}</span><button aria-label="Скрыть уведомление" onClick={() => setToast('')}><Icon name="close" size={16} /></button></div>}
    {auth && <AuthModal mode={auth} onClose={() => { setAuth(null); setNextBook(null); }} onSuccess={signedIn} />}
    {book && <BookModal book={book} user={user} onClose={() => setBook(null)} onLogin={() => { setNextBook(book); setBook(null); setAuth('login'); }} onBooked={() => { setBook(null); setRevision(v => v + 1); notify('Книга забронирована. Подробности — в личном кабинете.'); location.hash = 'account'; }} />}
  </>;
}
