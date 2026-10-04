import { useEffect, useState, type FormEvent } from 'react';
import { api, errorMessage } from './api';
import type { Book, Named, Recommendation } from './types';
import { BookCard, Icon, Empty, ErrorBox, Loading } from './ui';

const PAGE_SIZE = 12;
export default function Catalog({ onOpen, revision }: { onOpen: (book: Book) => void; revision: number }) {
  const [books, setBooks] = useState<Book[]>([]);
  const [genres, setGenres] = useState<Named[]>([]);
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [genre, setGenre] = useState('');
  const [mode, setMode] = useState<'title' | 'neural'>('title');
  const [page, setPage] = useState(0);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => { const c = new AbortController(); api<Named[]>('/catalog/genres', { signal: c.signal }).then(setGenres).catch(() => {}); return () => c.abort(); }, [revision]);
  useEffect(() => {
    const c = new AbortController();
    setLoading(true); setError('');
    (async () => {
      try {
        if (mode === 'neural' && query) {
          const results = await api<Recommendation[]>('/recommendations/search', { method: 'POST', body: { query, limit: 50 }, signal: c.signal, timeout: 300000 });
          setBooks(results.map(r => r.book)); setHasNext(false);
        } else {
          const params = new URLSearchParams({ q: query, limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) });
          if (genre) params.set('genre_id', genre);
          const results = await api<Book[]>(`/catalog/books?${params}`, { signal: c.signal });
          setBooks(results); setHasNext(results.length === PAGE_SIZE);
        }
      } catch (err) { if (!c.signal.aborted) { setError(errorMessage(err)); setBooks([]); } }
      finally { if (!c.signal.aborted) setLoading(false); }
    })();
    return () => c.abort();
  }, [query, genre, mode, page, revision, reload]);
  function search(e: FormEvent) { e.preventDefault(); setQuery(text.trim()); setPage(0); setReload(v => v + 1); }
  return <>
    <section className="hero"><div className="hero-copy"><span className="eyebrow"><span className="small-dot" />ОТКРЫТАЯ БИБЛИОТЕКА</span><h1>Следующая история<br />ждёт <em>вас.</em></h1><p>Находите книги, к которым хочется возвращаться.<br className="desktop-break" /> Выбирайте, бронируйте и открывайте новое.</p><a className="button primary" href="#collection">Найти свою книгу<Icon name="arrow" size={18} /></a><div className="hero-note"><Icon name="book" size={17} />Каталог открыт для всех. Бронирование — после входа.</div></div>
      <div className="hero-art" aria-hidden="true"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><span className="art-star">✧</span><div className="hero-book hero-book-back"><span>МЕЖДУ<br />СТРОК</span><small>истории, которые остаются</small></div><div className="hero-book hero-book-front"><small>НОВАЯ ГЛАВА</small><span>Мир<br /><i>внутри</i><br />книги</span><div className="hero-book-flower">✳</div><small>ОТКРОЙТЕ СВОЮ ИСТОРИЮ</small></div><div className="hero-art-caption">Меньше спешки. Больше страниц.</div></div>
    </section>
    <section id="collection" className="collection"><div className="heading-row"><div><span className="eyebrow">ВАША КНИЖНАЯ ПОЛКА</span><h2>Каталог книг</h2></div><span className="subtle-label">Выберите, что читать дальше</span></div>
      <form className="search-bar" onSubmit={search}><div className="search-input"><Icon name={mode === 'neural' ? 'sparkle' : 'search'} /><input aria-label="Поиск книг" placeholder={mode === 'neural' ? 'Например: уютная история о дружбе и путешествиях' : 'Найти книгу по названию…'} value={text} maxLength={4000} onChange={e => setText(e.target.value)} /></div><button className="button primary">Найти</button></form>
      <div className="catalog-controls"><div className="segmented search-mode"><button className={mode === 'title' ? 'selected' : ''} onClick={() => { setMode('title'); setPage(0); }}>По названию</button><button className={mode === 'neural' ? 'selected' : ''} onClick={() => { setMode('neural'); setGenre(''); setPage(0); }}><Icon name="sparkle" size={16} />По смыслу</button></div>{mode === 'title' && <label className="genre-filter"><span className="sr-only">Жанр</span><select value={genre} onChange={e => { setGenre(e.target.value); setPage(0); }}><option value="">Все жанры</option>{genres.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label>}</div>
      {mode === 'neural' && <p className="search-hint">Опишите настроение или сюжет — нейросеть найдёт близкие по смыслу книги. Первый запрос может занять несколько минут.</p>}
      {error && <ErrorBox text={error} retry={() => setReload(x => x + 1)} />}
      {loading ? <Loading text={mode === 'neural' && query ? 'Подбираем книги по смыслу…' : 'Открываем книжную полку…'} /> : !error && (books.length ? <div className="book-grid">{books.map(book => <BookCard book={book} key={book.id} onOpen={onOpen} neural={mode === 'neural' && !!query} />)}</div> : <Empty title={query || genre ? 'Ничего не нашлось' : 'Здесь скоро появятся книги'} text={query || genre ? 'Попробуйте другой запрос или уберите фильтр жанра.' : 'Сотрудник библиотеки может добавить книги в разделе управления.'} />)}
      {mode === 'title' && (page > 0 || hasNext) && !loading && !error && <div className="pagination"><button className="button secondary" disabled={page === 0} onClick={() => setPage(x => x - 1)}>Назад</button><span>Страница {page + 1}</span><button className="button secondary" disabled={!hasNext} onClick={() => setPage(x => x + 1)}>Далее<Icon name="arrow" size={16} /></button></div>}
    </section>
    <section className="reading-banner"><Icon name="sparkle" size={30} /><div><h3>Книги, которые понимают ваши интересы</h3><p>Личный кабинет подскажет следующую историю по вашим предпочтениям и уже прочитанным книгам.</p></div><a className="button secondary" href="#account">Моя подборка<Icon name="arrow" size={17} /></a></section>
  </>;
}
