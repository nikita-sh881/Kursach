import { useEffect, useState } from 'react';
import { api, errorMessage } from './api';
import type { Role, User } from './types';
import { Empty, ErrorBox, Loading, Modal, Icon } from './ui';

export const roleNames: Record<Role, string> = { reader: 'Читатель', staff: 'Сотрудник', admin: 'Администратор' };
export default function Admin({ current, notify, onSelfChanged }: { current: User; notify: (s: string) => void; onSelfChanged: () => void }) {
  const [users, setUsers] = useState<User[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState('');
  const [action, setAction] = useState<{ user: User; role?: Role; active?: boolean } | null>(null);
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const c = new AbortController(); setLoading(true); setError('');
    api<User[]>('/auth/users', { signal: c.signal }).then(setUsers).catch(err => { if (!c.signal.aborted) setError(errorMessage(err)); }).finally(() => { if (!c.signal.aborted) setLoading(false); });
    return () => c.abort();
  }, [refresh]);
  async function perform() {
    if (!action) return; setBusy(true); setActionError('');
    try {
      await api(`/auth/users/${action.user.id}/${action.role ? 'role' : 'state'}`, { method: 'PATCH', body: action.role ? { role: action.role } : { active: action.active } });
      if (action.user.id === current.id) { setAction(null); onSelfChanged(); notify('Доступ изменён. Войдите снова.'); }
      else { setAction(null); setRefresh(v => v + 1); notify('Доступ пользователя обновлён. Его прежние сессии завершены.'); }
    } catch (err) { setActionError(errorMessage(err)); } finally { setBusy(false); }
  }
  const visible = users.filter(u => u.email.toLowerCase().includes(query.toLowerCase()));
  return <div className="page-content"><div className="page-heading"><span className="eyebrow">НАСТРОЙКИ ДОСТУПА</span><h1>Пользователи</h1><p>Назначайте сотрудников и управляйте доступом к библиотеке.</p></div><section className="panel"><div className="heading-row"><h2>Учётные записи</h2><button className="text-button" onClick={() => setRefresh(v => v + 1)}>Обновить</button></div><div className="search-bar"><div className="search-input"><Icon name="search" /><input aria-label="Поиск пользователей" placeholder="Найти по электронной почте" value={query} onChange={e => setQuery(e.target.value)} /></div></div>
    {loading ? <Loading /> : error ? <ErrorBox text={error} retry={() => setRefresh(v => v + 1)} /> : visible.length ? <div className="table-wrap"><table><thead><tr><th>Пользователь</th><th>Роль</th><th>Доступ</th><th>Действия</th></tr></thead><tbody>{visible.map(u => <tr key={u.id}><td><strong>{u.email}</strong><small>№{u.id}{u.id === current.id ? ' · Это вы' : ''}</small></td><td><label><span className="sr-only">Роль {u.email}</span><select value={u.role} onChange={e => { setAction({ user: u, role: e.target.value as Role }); setActionError(''); }}>{Object.entries(roleNames).map(([role, label]) => <option key={role} value={role}>{label}</option>)}</select></label></td><td><span className={`badge ${u.active ? 'badge-returned' : 'badge-overdue'}`}>{u.active ? 'Активен' : 'Заблокирован'}</span></td><td><button className={`text-button ${u.active ? 'danger-text' : ''}`} onClick={() => { setAction({ user: u, active: !u.active }); setActionError(''); }}>{u.active ? 'Заблокировать' : 'Восстановить'}</button></td></tr>)}</tbody></table></div> : <Empty title="Пользователь не найден" />}
    <p className="field-hint">Показываем первые 500 пользователей. Изменение роли или блокировка отзывает все сессии пользователя. Последнего активного администратора нельзя лишить доступа.</p>
  </section>{action && <Modal title="Изменить доступ?" onClose={() => { if (!busy) setAction(null); }}><p>{action.user.email}: {action.role ? `назначить роль «${roleNames[action.role]}»` : action.active ? 'восстановить доступ' : 'заблокировать учётную запись'}.</p><p className="muted">Все текущие сессии этого пользователя завершатся.</p>{actionError && <ErrorBox text={actionError} />}<div className="modal-actions"><button className="button secondary" disabled={busy} onClick={() => setAction(null)}>Отмена</button><button className="button primary" disabled={busy} onClick={perform}>{busy ? 'Сохраняем…' : 'Подтвердить'}</button></div></Modal>}</div>;
}
