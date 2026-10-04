import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError, errorMessage, localInput } from './api';
import type { Book, Copy, User } from './types';
import { Modal, Cover, Icon, ErrorBox, Loading } from './ui';

export default function BookModal({ book, user, onClose, onLogin, onBooked }: { book: Book; user: User | null; onClose: () => void; onLogin: () => void; onBooked: () => void }) {
  const [start, setStart] = useState(localInput(new Date(Date.now() + 3600000)));
  const [end, setEnd] = useState(localInput(new Date(Date.now() + 7 * 86400000 + 3600000)));
  const [copies, setCopies] = useState<Copy[]>([]);
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const valid = !!start && !!end && new Date(end) > new Date(start) && new Date(end).getTime() - new Date(start).getTime() <= 60 * 86400000;
  useEffect(() => {
    setCopies([]); setSelected(''); setLoaded(false);
    if (!valid) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ book_id: String(book.id), starts_at: new Date(start).toISOString(), ends_at: new Date(end).toISOString() });
        const list = await api<Copy[]>(`/circulation/copies?${params}`, { signal: controller.signal });
        setCopies(list); setSelected(String(list.find(c => c.available)?.id || '')); setLoaded(true);
      } catch (err) { if (!controller.signal.aborted) setError(errorMessage(err)); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [book.id, start, end, valid, reload]);
  async function reserve(e: FormEvent) {
    e.preventDefault();
    if (!user) { onLogin(); return; }
    if (!valid || !selected) return;
    if (new Date(start).getTime() < Date.now()) { setError('Выберите время начала в будущем.'); return; }
    setBusy(true); setError('');
    try {
      await api('/circulation/reservations', { method: 'POST', body: { copy_id: Number(selected), starts_at: new Date(start).toISOString(), ends_at: new Date(end).toISOString() } });
      onBooked();
    } catch (err) { setError(errorMessage(err)); if (err instanceof ApiError && err.status === 409) setReload(x => x + 1); }
    finally { setBusy(false); }
  }
  const available = copies.filter(c => c.available);
  return <Modal title="О книге" onClose={onClose} wide>
    <div className="book-detail"><Cover book={book} large /><div><div className="tag-list">{book.genres.map(g => <span className="tag" key={g.id}>{g.name}</span>)}</div><h2 className="detail-title">{book.title}</h2><p className="detail-author">{book.authors.map(a => a.name).join(', ') || 'Автор не указан'}</p><p className="description">{book.description || 'Описание этой книги пока не добавлено.'}</p>{book.isbn && <p className="field-hint">ISBN {book.isbn}</p>}</div></div>
    <form onSubmit={reserve} className="reservation-form"><div className="section-title"><Icon name="calendar" /><h3>Выберите время для чтения</h3></div><p className="muted">Период до 60 дней. Даты указаны в часовом поясе вашего устройства.</p>
      <div className="form-row"><label>Начало бронирования<input type="datetime-local" required value={start} onChange={e => setStart(e.target.value)} /></label><label>Срок возврата<input type="datetime-local" required value={end} onChange={e => setEnd(e.target.value)} /></label></div>
      {!valid && <ErrorBox text="Дата возврата должна быть позже начала. Максимальный срок — 60 дней." />}
      {loading && <Loading text="Проверяем доступные экземпляры…" />}
      {loaded && valid && !loading && (available.length ? <label>Экземпляр<select value={selected} onChange={e => setSelected(e.target.value)}>{available.map(c => <option key={c.id} value={c.id}>Экземпляр {c.barcode}</option>)}</select><span className="field-hint">Доступно на выбранные даты: {available.length}</span></label> : <p className="availability-empty">На эти даты свободных экземпляров нет. Попробуйте изменить период.</p>)}
      {error && <ErrorBox text={error} />}
      <button className="button primary" disabled={busy || loading || !valid || (!!user && !selected)}>{busy ? 'Бронируем…' : user ? 'Забронировать книгу' : 'Войти и забронировать'}<Icon name="arrow" size={18} /></button>
      <p className="field-hint">Если экземпляр займут до подтверждения, предложим выбрать другой. О начале брони напомним по почте.</p>
    </form>
  </Modal>;
}
