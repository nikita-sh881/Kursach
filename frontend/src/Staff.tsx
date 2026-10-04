import { useEffect, useState, type FormEvent } from 'react';
import { api, dateTime, errorMessage } from './api';
import type { Book, Named, Copy, Booking, IndexStatus } from './types';
import { Modal, Icon, Empty, ErrorBox, Loading } from './ui';
import { BookingBadge, enrichBookings } from './Account';

type Props = { notify: (s: string) => void; onChanged: () => void };
export default function Staff({ notify, onChanged }: Props) {
  const [tab, setTab] = useState('books');
  const [books, setBooks] = useState<Book[]>([]);
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState('');
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [editing, setEditing] = useState<Book | 'new' | null>(null);
  const [copies, setCopies] = useState<Book | null>(null);
  const [remove, setRemove] = useState<Book | null>(null);
  const [busy, setBusy] = useState(false);
  const [removeError, setRemoveError] = useState('');
  const [index, setIndex] = useState<IndexStatus | null>(null);
  const [indexing, setIndexing] = useState(false);
  const [indexError, setIndexError] = useState('');
  useEffect(() => { api<IndexStatus>('/recommendations/status').then(setIndex).catch(() => {}); }, [refresh]);
  useEffect(() => {
    const c = new AbortController(); setLoading(true); setError('');
    api<Book[]>(`/catalog/books?${new URLSearchParams({ q: query, offset: String(page * 20), limit: '20' })}`, { signal: c.signal }).then(setBooks).catch(err => { if (!c.signal.aborted) setError(errorMessage(err)); }).finally(() => { if (!c.signal.aborted) setLoading(false); });
    return () => c.abort();
  }, [page, query, refresh]);
  async function reindex() {
    setIndexing(true); setIndexError('');
    try {
      const result = await api<{ indexed: number; model: string }>('/recommendations/reindex', { method: 'POST', timeout: 300000 });
      setIndex({ ...result, ready: result.indexed > 0 }); notify('Нейросетевые рекомендации обновлены.'); onChanged();
    } catch (err) { setIndexError(errorMessage(err)); }
    finally { setIndexing(false); }
  }
  function catalogChanged() { setRefresh(v => v + 1); onChanged(); }
  async function saveCompleted() { setEditing(null); catalogChanged(); notify('Книга сохранена.'); await reindex(); }
  async function archive() {
    if (!remove) return;
    setBusy(true); setRemoveError('');
    try { await api(`/catalog/books/${remove.id}`, { method: 'DELETE' }); setRemove(null); catalogChanged(); notify('Книга убрана из каталога.'); await reindex(); }
    catch (err) { setRemoveError(errorMessage(err)); }
    finally { setBusy(false); }
  }
  return <div className="page-content"><div className="page-heading"><span className="eyebrow">РАБОЧЕЕ МЕСТО СОТРУДНИКА</span><h1>Управление библиотекой</h1><p>Каталог, экземпляры и движение книг — в одном месте.</p></div>
    <div className="index-panel"><span className="index-icon"><Icon name="sparkle" /></span><div><h3>Нейросетевой каталог</h3><p>{index ? `${index.indexed} книг в индексе. ` : ''}{indexing ? 'Обновляем подборки… Первый запуск может занять несколько минут.' : 'После изменений книг обновляем рекомендации автоматически.'}</p></div><button className="button secondary" disabled={indexing} onClick={reindex}>{indexing ? 'Обновляем…' : 'Обновить рекомендации'}</button></div>{indexError && <ErrorBox text={'Каталог сохранён, но рекомендации не обновлены. ' + indexError} retry={reindex} />}
    <div className="tabs workspace-tabs"><button className={tab === 'books' ? 'active' : ''} onClick={() => setTab('books')}>Книги</button><button className={tab === 'loans' ? 'active' : ''} onClick={() => setTab('loans')}>Выдача и возврат</button><button className={tab === 'authors' ? 'active' : ''} onClick={() => setTab('authors')}>Авторы</button><button className={tab === 'genres' ? 'active' : ''} onClick={() => setTab('genres')}>Жанры</button></div>
    {tab === 'books' && <section className="panel"><div className="heading-row"><h2>Книжный фонд</h2><button className="button primary" disabled={indexing} onClick={() => setEditing('new')}><Icon name="plus" size={18} />Добавить книгу</button></div><form className="search-bar compact-search" onSubmit={e => { e.preventDefault(); setQuery(text.trim()); setPage(0); }}><div className="search-input"><Icon name="search" /><input aria-label="Поиск в книжном фонде" value={text} onChange={e => setText(e.target.value)} placeholder="Название книги" /></div><button className="button secondary">Найти</button></form>
      {loading ? <Loading /> : error ? <ErrorBox text={error} retry={() => setRefresh(v => v + 1)} /> : books.length ? <div className="table-wrap"><table><thead><tr><th>Книга</th><th>Авторы / ISBN</th><th>Действия</th></tr></thead><tbody>{books.map(b => <tr key={b.id}><td><strong>{b.title}</strong><small>№{b.id} · {b.genres.map(g => g.name).join(', ') || 'Без жанра'}</small></td><td>{b.authors.map(a => a.name).join(', ') || '—'}<small>{b.isbn || 'ISBN не указан'}</small></td><td><div className="table-actions"><button className="text-button" onClick={() => setCopies(b)}>Экземпляры</button><button className="icon-button" aria-label={`Редактировать ${b.title}`} disabled={indexing} onClick={() => setEditing(b)}><Icon name="edit" size={18} /></button><button className="text-button danger-text" disabled={indexing} onClick={() => { setRemove(b); setRemoveError(''); }}>Убрать</button></div></td></tr>)}</tbody></table></div> : <Empty title="Добавьте первую книгу" text="После создания книги добавьте хотя бы один физический экземпляр для бронирования." />}
      {(page > 0 || books.length === 20) && <div className="pagination"><button className="button secondary" disabled={!page} onClick={() => setPage(v => v - 1)}>Назад</button><span>Страница {page + 1}</span><button className="button secondary" disabled={books.length < 20} onClick={() => setPage(v => v + 1)}>Далее</button></div>}
    </section>}
    {tab === 'loans' && <LoanDesk notify={notify} />}
    {(tab === 'authors' || tab === 'genres') && <Dictionary key={tab} kind={tab} notify={notify} onChanged={() => { catalogChanged(); void reindex(); }} />}
    {editing && <BookEditor book={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={saveCompleted} />}
    {copies && <CopiesModal book={copies} onClose={() => setCopies(null)} notify={notify} />}
    {remove && <Modal title="Убрать книгу из каталога?" onClose={() => { if (!busy) setRemove(null); }}><p>«{remove.title}» больше не будет доступна для новых бронирований. История и существующие брони сохранятся.</p>{removeError && <ErrorBox text={removeError} />}<div className="modal-actions"><button className="button secondary" disabled={busy} onClick={() => setRemove(null)}>Оставить книгу</button><button className="button danger" disabled={busy} onClick={archive}>{busy ? 'Убираем…' : 'Убрать из каталога'}</button></div></Modal>}
  </div>;
}

function BookEditor({ book, onClose, onSaved }: { book: Book | null; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(book?.title || '');
  const [description, setDescription] = useState(book?.description || '');
  const [isbn, setIsbn] = useState(book?.isbn || '');
  const [authors, setAuthors] = useState<Named[]>([]);
  const [genres, setGenres] = useState<Named[]>([]);
  const [authorIds, setAuthorIds] = useState(book?.authors.map(a => a.id) || []);
  const [genreIds, setGenreIds] = useState(book?.genres.map(g => g.id) || []);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    Promise.all([api<Named[]>('/catalog/authors'), api<Named[]>('/catalog/genres')]).then(([a, g]) => { if (active) { setAuthors(a); setGenres(g); } }).catch(err => { if (active) setError(errorMessage(err)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  function toggle(ids: number[], id: number) { return ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]; }
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try { await api(book ? `/catalog/books/${book.id}` : '/catalog/books', { method: book ? 'PUT' : 'POST', body: { title: title.trim(), description, isbn: isbn.trim() || null, author_ids: authorIds, genre_ids: genreIds } }); onSaved(); }
    catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  }
  return <Modal title={book ? 'Редактировать книгу' : 'Добавить книгу'} onClose={() => { if (!busy) onClose(); }} wide><form className="form-stack" onSubmit={submit}>
    <label>Название<input autoFocus required maxLength={500} value={title} onChange={e => setTitle(e.target.value)} /></label><label>Описание<textarea rows={4} maxLength={20000} value={description} onChange={e => setDescription(e.target.value)} /><span className="field-hint">Подробное описание помогает нейросети находить подходящие книги.</span></label><label>ISBN<input maxLength={32} value={isbn} onChange={e => setIsbn(e.target.value)} placeholder="Необязательно" /></label>
    {loading ? <Loading /> : <div className="form-row"><fieldset><legend>Авторы</legend><div className="checkbox-list">{authors.length ? authors.map(a => <label key={a.id}><input type="checkbox" checked={authorIds.includes(a.id)} onChange={() => setAuthorIds(toggle(authorIds, a.id))} />{a.name}</label>) : <p className="field-hint">Сначала добавьте авторов в соответствующей вкладке.</p>}</div></fieldset><fieldset><legend>Жанры</legend><div className="checkbox-list">{genres.length ? genres.map(g => <label key={g.id}><input type="checkbox" checked={genreIds.includes(g.id)} onChange={() => setGenreIds(toggle(genreIds, g.id))} />{g.name}</label>) : <p className="field-hint">Сначала добавьте жанры в соответствующей вкладке.</p>}</div></fieldset></div>}
    {error && <ErrorBox text={error} />}<div className="modal-actions"><button type="button" className="button secondary" disabled={busy} onClick={onClose}>Отмена</button><button className="button primary" disabled={busy || loading || !title.trim()}>{busy ? 'Сохраняем…' : 'Сохранить книгу'}</button></div>
  </form></Modal>;
}

function CopiesModal({ book, onClose, notify }: { book: Book; onClose: () => void; notify: (s: string) => void }) {
  const [rows, setRows] = useState<Copy[]>([]);
  const [barcode, setBarcode] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [remove, setRemove] = useState<number | null>(null);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const c = new AbortController(); setLoading(true);
    const params = new URLSearchParams({ book_id: String(book.id), starts_at: new Date().toISOString(), ends_at: new Date(Date.now() + 7 * 86400000).toISOString() });
    api<Copy[]>(`/circulation/copies?${params}`, { signal: c.signal }).then(setRows).catch(err => { if (!c.signal.aborted) setError(errorMessage(err)); }).finally(() => { if (!c.signal.aborted) setLoading(false); });
    return () => c.abort();
  }, [refresh, book.id]);
  async function add(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try { await api('/circulation/copies', { method: 'POST', body: { book_id: book.id, barcode: barcode.trim() } }); setBarcode(''); setRefresh(v => v + 1); notify('Экземпляр добавлен.'); }
    catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  }
  async function retire(id: number) {
    setBusy(true); setError('');
    try { await api(`/circulation/copies/${id}`, { method: 'DELETE' }); setRemove(null); setRefresh(v => v + 1); notify('Экземпляр списан.'); }
    catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  }
  return <Modal title={`Экземпляры: ${book.title}`} onClose={onClose}><form className="inline-form" onSubmit={add}><label>Штрихкод нового экземпляра<input required maxLength={100} value={barcode} onChange={e => setBarcode(e.target.value)} placeholder="BOOK-001" /></label><button className="button primary" disabled={busy || !barcode.trim()}><Icon name="plus" size={18} />Добавить</button></form>{error && <ErrorBox text={error} />}
    {loading ? <Loading /> : rows.length ? <div className="copy-list">{rows.map(c => <div className="copy-row" key={c.id}><div><strong>{c.barcode}</strong><small>{c.available ? 'Свободен на ближайшую неделю' : 'Есть бронирования или выдача'}</small></div>{remove === c.id ? <div className="table-actions"><button className="text-button danger-text" disabled={busy} onClick={() => retire(c.id)}>Подтвердить списание</button><button className="text-button" onClick={() => setRemove(null)}>Отмена</button></div> : <button className="text-button danger-text" disabled={busy} onClick={() => setRemove(c.id)}>Списать</button>}</div>)}</div> : <Empty title="Экземпляров пока нет" text="Добавьте физический экземпляр, чтобы читатели могли бронировать книгу." />}
  </Modal>;
}

function Dictionary({ kind, notify, onChanged }: Props & { kind: 'authors' | 'genres' }) {
  const [rows, setRows] = useState<Named[]>([]);
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<Named | null>(null);
  const [remove, setRemove] = useState<Named | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const c = new AbortController(); setLoading(true);
    api<Named[]>(`/catalog/${kind}`, { signal: c.signal }).then(setRows).catch(err => { if (!c.signal.aborted) setError(errorMessage(err)); }).finally(() => { if (!c.signal.aborted) setLoading(false); });
    return () => c.abort();
  }, [kind, refresh]);
  async function save(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try { await api(`/catalog/${kind}${editing ? '/' + editing.id : ''}`, { method: editing ? 'PUT' : 'POST', body: { name: name.trim() } }); setName(''); setEditing(null); setRefresh(v => v + 1); notify('Запись сохранена.'); onChanged(); }
    catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  }
  async function deleteItem() {
    if (!remove) return; setBusy(true); setError('');
    try { await api(`/catalog/${kind}/${remove.id}`, { method: 'DELETE' }); setRemove(null); setRefresh(v => v + 1); notify('Запись удалена.'); onChanged(); }
    catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  }
  return <section className="panel"><h2>{kind === 'authors' ? 'Авторы' : 'Жанры'}</h2><form className="inline-form" onSubmit={save}><label>{editing ? 'Изменить название' : kind === 'authors' ? 'Имя автора' : 'Название жанра'}<input required maxLength={200} value={name} onChange={e => setName(e.target.value)} /></label><button className="button primary" disabled={busy || !name.trim()}>{editing ? 'Сохранить' : 'Добавить'}</button>{editing && <button type="button" className="text-button" onClick={() => { setEditing(null); setName(''); }}>Отмена</button>}</form>{error && <ErrorBox text={error} />}
    {loading ? <Loading /> : rows.length ? <div className="dictionary-list">{rows.map(r => <div className="copy-row" key={r.id}><strong>{r.name}</strong><div className="table-actions"><button className="text-button" onClick={() => { setEditing(r); setName(r.name); }}>Изменить</button><button className="text-button danger-text" onClick={() => { setRemove(r); setError(''); }}>Удалить</button></div></div>)}</div> : <Empty title="Справочник пока пуст" />}
    {remove && <Modal title="Удалить запись?" onClose={() => { if (!busy) setRemove(null); }}><p>«{remove.name}». Запись можно удалить, если она не используется книгами.</p>{error && <ErrorBox text={error} />}<div className="modal-actions"><button className="button secondary" disabled={busy} onClick={() => setRemove(null)}>Отмена</button><button className="button danger" disabled={busy} onClick={deleteItem}>Удалить</button></div></Modal>}
  </section>;
}

function LoanDesk({ notify }: { notify: (s: string) => void }) {
  const [rows, setRows] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [filter, setFilter] = useState('active');
  const [query, setQuery] = useState('');
  const [action, setAction] = useState<{ b: Booking; kind: 'checkout' | 'return' | 'cancel' } | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  useEffect(() => {
    let active = true; setLoading(true); setError('');
    api<Booking[]>('/circulation/bookings?limit=500').then(enrichBookings).then(data => { if (active) setRows(data); }).catch(err => { if (active) setError(errorMessage(err)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [refresh]);
  async function perform() {
    if (!action) return; setBusy(true); setActionError('');
    const { b, kind } = action;
    const path = kind === 'return' ? `/circulation/loans/${b.id}/return` : `/circulation/reservations/${b.id}/${kind}`;
    try { await api(path, { method: 'POST' }); setAction(null); setRefresh(v => v + 1); notify(kind === 'return' ? 'Возврат зарегистрирован.' : kind === 'checkout' ? 'Книга выдана читателю.' : 'Бронирование отменено.'); }
    catch (err) { setActionError(errorMessage(err)); } finally { setBusy(false); }
  }
  const visible = rows.filter(b => (filter === 'all' || (filter === 'active' ? ['reserved', 'loaned'].includes(b.status) : b.status === filter)) && `${b.id} ${b.email} ${b.barcode} ${b.book_title}`.toLowerCase().includes(query.toLowerCase()));
  function open(b: Booking, kind: 'checkout' | 'return' | 'cancel') { setAction({ b, kind }); setActionError(''); }
  return <section className="panel"><div className="heading-row"><h2>Бронирования и выдачи</h2><button className="text-button" onClick={() => setRefresh(v => v + 1)}>Обновить</button></div><div className="form-row"><label>Поиск<input placeholder="Почта читателя, книга, штрихкод или номер брони" value={query} onChange={e => setQuery(e.target.value)} /></label><label>Статус<select value={filter} onChange={e => setFilter(e.target.value)}><option value="active">Активные</option><option value="reserved">Бронирования</option><option value="loaned">На руках</option><option value="returned">Возвращены</option><option value="all">Все записи</option></select></label></div>
    {loading ? <Loading /> : error ? <ErrorBox text={error} retry={() => setRefresh(v => v + 1)} /> : visible.length ? <div className="table-wrap"><table><thead><tr><th>Книга / читатель</th><th>Период</th><th>Статус</th><th>Действия</th></tr></thead><tbody>{visible.map(b => <tr key={b.id}><td><strong>{b.book_title}</strong><small>{b.email}</small><small>Бронь №{b.id} · {b.barcode || b.copy_id}</small></td><td>{dateTime(b.starts_at)}<small>до {dateTime(b.ends_at)}</small></td><td><BookingBadge booking={b} /></td><td><div className="table-actions">{b.status === 'reserved' && <><button className="text-button" disabled={new Date(b.starts_at).getTime() > Date.now() || new Date(b.ends_at).getTime() <= Date.now()} onClick={() => open(b, 'checkout')}>Выдать</button><button className="text-button danger-text" onClick={() => open(b, 'cancel')}>Отменить</button></>}{b.status === 'loaned' && <button className="button secondary small-button" onClick={() => open(b, 'return')}>Принять возврат</button>}</div></td></tr>)}</tbody></table></div> : <Empty title="Нет подходящих записей" text="Бронирования читателей появятся здесь после оформления в каталоге." />}
    <p className="field-hint">Последние 500 записей. Выдать книгу можно только после начала брони.</p>
    {action && <Modal title={action.kind === 'checkout' ? 'Выдать книгу?' : action.kind === 'return' ? 'Принять возврат?' : 'Отменить бронь читателя?'} onClose={() => { if (!busy) setAction(null); }}><p>«{action.b.book_title}» · {action.b.email} · экземпляр {action.b.barcode || action.b.copy_id}.</p>{actionError && <ErrorBox text={actionError} />}<div className="modal-actions"><button className="button secondary" disabled={busy} onClick={() => setAction(null)}>Назад</button><button className="button primary" disabled={busy} onClick={perform}>{busy ? 'Сохраняем…' : 'Подтвердить'}</button></div></Modal>}
  </section>;
}
