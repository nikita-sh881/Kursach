const SESSION_KEY = 'list.session';
let token = sessionStorage.getItem(SESSION_KEY) || '';

const messages: Record<string, string> = {
  'Invalid credentials': 'Неверная почта или пароль.',
  'Email already registered': 'Эта почта уже зарегистрирована. Попробуйте войти.',
  'Invalid or expired token': 'Сессия завершилась. Войдите снова.',
  'Insufficient permissions': 'Для этого действия недостаточно прав.',
  'Administrator required': 'Это действие доступно администратору.',
  'Copy already reserved during this interval': 'Этот экземпляр уже занят на выбранные даты. Выберите другой период или экземпляр.',
  'Copy is overdue and not yet returned': 'Предыдущий читатель ещё не вернул книгу. Выберите другой экземпляр.',
  'Previous reader has not returned the copy': 'Предыдущий читатель ещё не вернул экземпляр.',
  'Booking is not ready for checkout': 'Выдать книгу можно только в пределах срока активного бронирования.',
  'Only reserved bookings can be cancelled': 'Эту бронь уже нельзя отменить. Обновите список.',
  'Booking is not an active loan': 'Возврат уже зарегистрирован или книга ещё не выдана.',
  'Reservation must start in the future': 'Начало бронирования должно быть в будущем.',
  'Copy has active bookings or loans': 'Экземпляр нельзя списать, пока у него есть бронирования или выдачи.',
  'Barcode already exists': 'Этот штрихкод уже используется.',
  'Duplicate ISBN or invalid author/genre': 'Проверьте уникальность ISBN и выбранных авторов и жанры.',
  'Name already exists': 'Такое название уже существует.',
  'Author/genre is used by a book': 'Сначала уберите автора или жанр из связанных книг.',
  'Cannot remove the last administrator': 'Нельзя понизить последнего администратора.',
  'Cannot disable the last administrator': 'Нельзя заблокировать последнего администратора.',
  'Neural index is not ready; ask staff to reindex the catalog': 'Рекомендации ещё готовятся. Сотруднику нужно обновить индекс книг.',
};

export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
export function setToken(value: string) {
  token = value;
  if (value) sessionStorage.setItem(SESSION_KEY, value);
  else sessionStorage.removeItem(SESSION_KEY);
}
export function hasToken() { return !!token; }

export async function api<T>(path: string, options: { method?: string; body?: unknown; signal?: AbortSignal; timeout?: number } = {}): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const timer = window.setTimeout(abort, options.timeout || 30000);
  try {
    const response = await fetch(path, {
      method: options.method || 'GET', signal: controller.signal,
      headers: { ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      if (response.status === 401 && token && path !== '/auth/login') {
        setToken(''); window.dispatchEvent(new Event('session-expired'));
      }
      const detail = typeof data.detail === 'string' ? data.detail : '';
      const fallback = response.status === 422 ? 'Проверьте поля формы и выбранные даты.' : response.status === 429 ? 'Слишком много попыток. Подождите минуту.' : response.status === 404 ? 'Запись не найдена. Возможно, она была удалена.' : response.status >= 500 ? 'Сервис временно недоступен. Попробуйте позже.' : 'Не удалось выполнить действие.';
      throw new ApiError(response.status, messages[detail] || fallback);
    }
    return response.status === 204 ? undefined as T : await response.json();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (options.signal?.aborted) throw error;
    throw new Error(controller.signal.aborted ? 'Запрос занял слишком много времени. Попробуйте ещё раз.' : 'Нет связи с сервером. Проверьте подключение.');
  } finally {
    clearTimeout(timer); options.signal?.removeEventListener('abort', abort);
  }
}

export function errorMessage(error: unknown) { return error instanceof Error ? error.message : 'Не удалось выполнить действие.'; }
export function dateTime(value: string) { return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)); }
export function localInput(date: Date) { return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
