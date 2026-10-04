import { useEffect, useRef, type ReactNode } from 'react';
import type { Book } from './types';

export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    book: <><path d="M3 4h6a4 4 0 0 1 3 2 4 4 0 0 1 3-2h6v15h-6a4 4 0 0 0-3 2 4 4 0 0 0-3-2H3Z" /><path d="M12 6v15" /></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>,
    arrow: <><path d="M4 12h16m-6-6 6 6-6 6" /></>,
    sparkle: <><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z" /><path d="m20 2 .7 1.3L22 4l-1.3.7L20 6l-.7-1.3L18 4l1.3-.7Z" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4m10-4v4M3 10h18m-13 4h2m4 0h2m-8 4h2" /></>,
    user: <><circle cx="12" cy="8" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    plus: <path d="M12 4v16M4 12h16" />,
    edit: <><path d="m16 3 5 5-12 12-6 1 1-6Z" /><path d="m13 6 5 5" /></>,
    settings: <><path d="M4 7h16M4 17h16" /><circle cx="9" cy="7" r="3" /><circle cx="15" cy="17" r="3" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.book}</svg>;
}

export function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const previousFocus = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => { if (dialog.open) dialog.close(); previousFocus.current?.focus({ preventScroll: true }); };
  }, []);
  return <dialog ref={ref} className={wide ? 'modal modal-wide' : 'modal'} aria-label={title} onCancel={e => { e.preventDefault(); onClose(); }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="modal-heading"><h2>{title}</h2><button className="icon-button" aria-label="Закрыть окно" onClick={onClose}><Icon name="close" /></button></div>
    {children}
  </dialog>;
}

export function Empty({ title, text, children }: { title: string; text?: string; children?: ReactNode }) {
  return <div className="empty"><span className="empty-icon"><Icon name="book" size={30} /></span><h3>{title}</h3>{text && <p>{text}</p>}{children}</div>;
}
export function ErrorBox({ text, retry }: { text: string; retry?: () => void }) {
  return <div className="error-box" role="alert"><span>{text}</span>{retry && <button className="text-button" onClick={retry}>Попробовать снова</button>}</div>;
}
export function Loading({ text = 'Загружаем…' }: { text?: string }) {
  return <div className="loading" role="status"><span className="spinner" />{text}</div>;
}
export function Cover({ book, large = false }: { book: Book; large?: boolean }) {
  return <div className={`book-cover cover-${book.id % 6} ${large ? 'cover-large' : ''}`} aria-hidden="true">
    <span className="cover-series">БИБЛИОТЕКА · ЛИСТ</span><div className="cover-art"><span /><span /><span /></div>
    <span className="cover-title">{book.title}</span><span className="cover-author">{book.authors.map(a => a.name).join(', ') || 'Библиотечное издание'}</span>
  </div>;
}
export function BookCard({ book, onOpen, neural = false }: { book: Book; onOpen: (book: Book) => void; neural?: boolean }) {
  return <article className="book-card"><button className="cover-button" onClick={() => onOpen(book)} aria-label={`Подробнее: ${book.title}`}><Cover book={book} /></button>
    <div className="book-meta"><span>{book.genres[0]?.name || 'Книга'}</span>{neural && <span className="neural-label"><Icon name="sparkle" size={14} />Подбор для вас</span>}</div>
    <h3><button onClick={() => onOpen(book)}>{book.title}</button></h3><p className="book-author">{book.authors.map(a => a.name).join(', ') || 'Автор не указан'}</p>
    <button className="card-action" onClick={() => onOpen(book)}>Подробнее и бронирование<Icon name="arrow" size={17} /></button>
  </article>;
}
