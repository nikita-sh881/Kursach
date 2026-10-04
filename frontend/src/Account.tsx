import { useEffect, useState, type FormEvent } from 'react';
import { api, dateTime, errorMessage } from './api';
import type { Book, Booking, BookingStatus, Personal, User } from './types';
import { BookCard, Icon, Empty, ErrorBox, Loading, Modal } from './ui';

export const statuses: Record<BookingStatus, string> = { reserved: 'Забронирована', loaned: 'На руках', returned: 'Возвращена', cancelled: 'Отменена', expired: 'Срок брони истёк' };
export function BookingBadge({ booking }: { booking: Booking }) {
  const overdue = booking.status === 'loaned' && new Date(booking.ends_at).getTime() < Date.now();
  return <span className={`badge badge-${overdue ? 'overdue' : booking.status}`}>{overdue ? 'Просрочен возврат' : statuses[booking.status]}</span>;
}
export async function enrichBookings(rows: Booking[]) {
  const ids = [...new Set(rows.map(b => b.book_id).filter((i): i is number => !!i))];
  const results = await Promise.all(ids.map(async id => {
    try { return [id, await api<Book>(`/catalog/books/${id}`)] as const; }
    catch { return [id, null] as const; }
  }));
  const books = new Map(results);
  return rows.map(b => ({ ...b, book_title: (b.book_id && books.get(b.book_id)?.title) || `Книга №${b.book_id || b.copy_id} (нет в каталоге)` }));
}

export default function Account({ user, onOpen, notify, revision }: { user: User; onOpen: (b: Book) => void; notify: (message: string) => void; revision: number }) {
  const key = `list.interests.${user.id}`;
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [filter, setFilter] = useState('active');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [cancel, setCancel] = useState<Booking | null>(null);
  const [busy, setBusy] = useState(false);
  const [cancelError, setCancelError] = useState('');
  const [interestInput, setInterestInput] = useState(localStorage.getItem(key) || '');
  const [interests, setInterests] = useState(localStorage.getItem(key) || '');
  const [personal, setPersonal] = useState<Personal | null>(null);
  const [aiLoading, setAiLoading] = useState(true);
  const [aiError, setAiError] = useState('');
  const [aiRefresh, setAiRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    api<Booking[]>('/circulation/reservations?limit=500').then(enrichBookings).then(rows => { if (active) setBookings(rows); }).catch(err => { if (active) setError(errorMessage(err)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [refresh, revision, user.id]);
  useEffect(() => {
    const c = new AbortController(); setAiLoading(true); setAiError('');
    const params = new URLSearchParams({ interests, limit: '6' });
    api<Personal>(`/recommendations/me?${params}`, { signal: c.signal, timeout: 300000 }).then(setPersonal).catch(err => { if (!c.signal.aborted) setAiError(errorMessage(err)); }).finally(() => { if (!c.signal.aborted) setAiLoading(false); });
    return () => c.abort();
  }, [interests, aiRefresh, revision, user.id]);
  async function cancelBooking() {
    if (!cancel) return;
    setBusy(true); setCancelError('');
    try { await api(`/circulation/reservations/${cancel.id}/cancel`, { method: 'POST' }); setCancel(null); setRefresh(x => x + 1); notify('Бронирование отменено.'); }
    catch (err) { setCancelError(errorMessage(err)); }
    finally { setBusy(false); }
  }
  function recommend(e: FormEvent) { e.preventDefault(); localStorage.setItem(key, interestInput.trim()); setInterests(interestInput.trim()); setAiRefresh(x => x + 1); }
  const active = bookings.filter(b => ['reserved', 'loaned'].includes(b.status));
  const visible = filter === 'active' ? active : bookings.filter(b => !['reserved', 'loaned'].includes(b.status));
  return <div className="page-content"><div className="page-heading"><span className="eyebrow">ВАШЕ МЕСТО В БИБЛИОТЕКЕ</span><h1>Личный кабинет</h1><p>{user.email}</p></div>
    <div className="stats-grid"><div className="stat"><Icon name="calendar" /><strong>{bookings.filter(b => b.status === 'reserved').length}</strong><span>Активных бронирований</span></div><div className="stat"><Icon name="book" /><strong>{bookings.filter(b => b.status === 'loaned').length}</strong><span>Книг на руках</span></div><div className="stat"><Icon name="check" /><strong>{bookings.filter(b => b.status === 'returned').length}</strong><span>Возвращено книг</span></div></div>
    <section className="panel"><div className="heading-row"><h2>Мои книги</h2><button className="text-button" onClick={() => setRefresh(x => x + 1)}>Обновить</button></div><div className="tabs"><button className={filter === 'active' ? 'active' : ''} onClick={() => setFilter('active')}>Бронирования и выдачи <span>{active.length}</span></button><button className={filter === 'history' ? 'active' : ''} onClick={() => setFilter('history')}>История</button></div>
      {loading ? <Loading /> : error ? <ErrorBox text={error} retry={() => setRefresh(x => x + 1)} /> : visible.length ? <div className="booking-list">{visible.map(b => <article className="booking-row" key={b.id}><div className="booking-mark"><Icon name="book" /></div><div className="booking-info"><h3>{b.book_title}</h3><p>Бронь №{b.id} · Экземпляр {b.barcode || b.copy_id}</p><span>{dateTime(b.starts_at)} — {dateTime(b.ends_at)}</span></div><div className="booking-actions"><BookingBadge booking={b} />{b.status === 'reserved' && <button className="text-button danger-text" onClick={() => { setCancel(b); setCancelError(''); }}>Отменить бронь</button>}</div></article>)}</div> : <Empty title={filter === 'active' ? 'Время для новой истории' : 'История пока пуста'} text={filter === 'active' ? 'Выберите книгу в каталоге и забронируйте удобный период.' : 'Здесь появятся возвращённые книги и завершённые бронирования.'}><a className="button secondary" href="#catalog">Перейти в каталог<Icon name="arrow" size={17} /></a></Empty>}
      <p className="field-hint">Показываем последние 500 записей. О готовности книги и сроках возврата сообщим по электронной почте.</p>
    </section>
    <section className="recommendation-section"><div className="heading-row"><div><span className="eyebrow"><Icon name="sparkle" size={15} /> НЕЙРОСЕТЕВОЙ ПОДБОР</span><h2>Следующая книга — для вас</h2></div></div><p className="muted">Расскажите, что вам нравится. Подбор учитывает ваши интересы и историю чтения.</p><form className="interest-form" onSubmit={recommend}><label className="sr-only" htmlFor="interests">Ваши читательские интересы</label><input id="interests" placeholder="Например: научная фантастика, психология, тёплые истории о дружбе" value={interestInput} maxLength={4000} onChange={e => setInterestInput(e.target.value)} /><button className="button primary" disabled={aiLoading}><Icon name="sparkle" size={17} />Подобрать книги</button></form>
      {aiLoading ? <Loading text="Нейросеть подбирает книги… При первом запуске это может занять несколько минут." /> : aiError ? <ErrorBox text={aiError} retry={() => setAiRefresh(x => x + 1)} /> : personal?.items.length ? <><p className="field-hint">{personal.basis === 'reading_history' ? 'На основе вашей истории чтения и интересов.' : personal.basis === 'interests' ? 'На основе указанных вами интересов.' : 'Первая нейросетевая подборка. Укажите интересы, чтобы сделать её ближе к вам.'}</p><div className="book-grid recommendation-grid">{personal.items.map(r => <BookCard key={r.book.id} book={r.book} onOpen={onOpen} neural />)}</div></> : <Empty title="Пока нет новых рекомендаций" text="Добавьте интересы или вернитесь позже, когда каталог пополнится." />}
    </section>
    {cancel && <Modal title="Отменить бронирование?" onClose={() => { if (!busy) setCancel(null); }}><p>Экземпляр книги «{cancel.book_title}» станет доступен другим читателям.</p>{cancelError && <ErrorBox text={cancelError} />}<div className="modal-actions"><button className="button secondary" disabled={busy} onClick={() => setCancel(null)}>Оставить бронь</button><button className="button danger" disabled={busy} onClick={cancelBooking}>{busy ? 'Отменяем…' : 'Отменить бронирование'}</button></div></Modal>}
  </div>;
}
