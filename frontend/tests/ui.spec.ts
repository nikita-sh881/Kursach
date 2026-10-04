import { test, expect, type Page, type Request } from '@playwright/test';

const book = { id: 1, title: 'Путешествие к звёздам', description: 'История о дружбе и космических открытиях.', isbn: '978-1', authors: [{ id: 1, name: 'Ирина Светлова' }], genres: [{ id: 1, name: 'Фантастика' }] };
const booking = { id: 9, copy_id: 3, book_id: 1, barcode: 'SPACE-001', user_id: 7, email: 'reader@example.com', status: 'reserved', starts_at: new Date(Date.now() + 3600000).toISOString(), ends_at: new Date(Date.now() + 7 * 86400000).toISOString() };
type Options = { role?: 'reader' | 'staff' | 'admin'; conflict?: boolean; aiUnavailable?: boolean; expireOnReservations?: boolean; loanDesk?: boolean };
async function backend(page: Page, options: Options = {}) {
  const calls: Request[] = [];
  let reserved = false;
  let cancelled = false;
  let conflicts = options.conflict ? 1 : 0;
  let collection = [book];
  let deskStatus = 'reserved';
  const users = [{ id: 7, email: 'reader@example.com', role: 'admin', active: true }, { id: 8, email: 'other@example.com', role: 'reader', active: true }];
  await page.route(/\/(auth|catalog|circulation|recommendations)\//, async route => {
    const req = route.request(); calls.push(req);
    const url = new URL(req.url()); const path = url.pathname; const method = req.method();
    let status = 200; let data: unknown;
    if (path === '/auth/register') { status = 201; data = { id: 7, email: 'reader@example.com', role: 'reader' }; }
    else if (path === '/auth/login') data = { access_token: 'ui-test-token', token_type: 'bearer', expires_in: 1800 };
    else if (path === '/auth/me') data = { id: 7, email: 'reader@example.com', role: options.role || 'reader' };
    else if (path === '/auth/logout') status = 204;
    else if (path === '/auth/users') data = users;
    else if (path.startsWith('/auth/users/8/') && method === 'PATCH') { Object.assign(users[1], req.postDataJSON()); data = users[1]; }
    else if (path === '/catalog/books' && method === 'GET') data = collection.filter(b => b.title.toLowerCase().includes((url.searchParams.get('q') || '').toLowerCase()));
    else if (path === '/catalog/books' && method === 'POST') {
      const body = req.postDataJSON();
      data = { ...book, ...body, id: 2, authors: body.author_ids.includes(1) ? book.authors : [], genres: body.genre_ids.includes(1) ? book.genres : [] };
      collection.push(data as typeof book); status = 201;
    }
    else if (path === '/catalog/books/1' && method === 'GET') data = book;
    else if (path === '/catalog/authors') data = book.authors;
    else if (path === '/catalog/genres') data = book.genres;
    else if (path === '/circulation/copies') data = [{ id: 3, book_id: 1, barcode: 'SPACE-001', active: true, available: true }];
    else if (path === '/circulation/reservations' && method === 'GET') {
      if (options.expireOnReservations) { status = 401; data = { detail: 'Invalid or expired token' }; }
      else data = reserved ? [{ ...booking, status: cancelled ? 'cancelled' : 'reserved' }] : [];
    }
    else if (path === '/circulation/reservations' && method === 'POST') {
      if (conflicts > 0) { conflicts--; status = 409; data = { detail: 'Copy already reserved during this interval' }; }
      else { reserved = true; status = 201; data = booking; }
    }
    else if (path === '/circulation/reservations/9/cancel') { cancelled = true; data = { ...booking, status: 'cancelled' }; }
    else if (path === '/circulation/bookings') data = options.loanDesk ? [{ ...booking, status: deskStatus, starts_at: new Date(Date.now() - 60000).toISOString() }] : [];
    else if (path === '/circulation/reservations/9/checkout') { deskStatus = 'loaned'; data = { ...booking, status: deskStatus }; }
    else if (path === '/circulation/loans/9/return') { deskStatus = 'returned'; data = { ...booking, status: deskStatus }; }
    else if (path === '/recommendations/status') data = { indexed: 1, ready: true, model: 'actual-model-name' };
    else if (path === '/recommendations/reindex') data = { indexed: collection.length, model: 'actual-model-name' };
    else if (path === '/recommendations/search' || path === '/recommendations/me') {
      if (options.aiUnavailable) { status = 503; data = { detail: 'Neural index is not ready; ask staff to reindex the catalog' }; }
      else data = path.endsWith('/me') ? { basis: 'interests', items: [{ book, score: .82 }] } : [{ book, score: .82 }];
    }
    else { status = 404; data = { detail: 'Not found' }; }
    await route.fulfill({ status, contentType: 'application/json', body: status === 204 ? '' : JSON.stringify(data) });
  });
  return calls;
}
async function login(page: Page) {
  await page.getByRole('button', { name: 'Войти', exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Электронная почта').fill('reader@example.com');
  await dialog.getByLabel('Пароль', { exact: true }).fill('Reader-password-123!');
  await dialog.getByRole('button', { name: 'Войти в библиотеку' }).click();
  await expect(dialog).toBeHidden();
}

test('каталог и доступность видны без регистрации, мобильная страница не переполняется', async ({ page }) => {
  const calls = await backend(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Каталог книг' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Путешествие к звёздам', exact: true })).toBeVisible();
  expect(calls.filter(c => c.url().includes('/auth/'))).toHaveLength(0);
  await page.getByRole('button', { name: 'Подробнее: Путешествие к звёздам' }).click();
  await expect(page.getByRole('dialog').getByText('Доступно на выбранные даты: 1')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Войти и забронировать' })).toBeEnabled();
  const copiesCall = calls.find(c => c.url().includes('/circulation/copies'))!;
  expect(copiesCall.headers()['authorization']).toBeUndefined();
  await page.getByRole('button', { name: 'Закрыть окно' }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.screenshot({ path: `test-results/catalog-${test.info().project.name}.png`, fullPage: true });
});

test('регистрация проверяет подтверждение пароля и открывает кабинет', async ({ page }) => {
  const calls = await backend(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Регистрация', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Электронная почта').fill('reader@example.com');
  await dialog.getByLabel('Пароль', { exact: true }).fill('Reader-password-123!');
  await dialog.getByLabel('Повторите пароль').fill('Different-password!');
  await dialog.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Пароли не совпадают.');
  await dialog.getByLabel('Повторите пароль').fill('Reader-password-123!');
  await dialog.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(dialog).toBeHidden();
  const registration = calls.find(c => c.url().endsWith('/auth/register'))!;
  expect(registration.postDataJSON()).toEqual({ email: 'reader@example.com', password: 'Reader-password-123!' });
  await page.getByRole('link', { name: 'Мои книги', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Личный кабинет' })).toBeVisible();
  await expect(page.getByText('На основе указанных вами интересов.')).toBeVisible();
  await page.getByLabel('Ваши читательские интересы').fill('Путешествия и космос');
  await page.getByRole('button', { name: 'Подобрать книги' }).click();
  await expect.poll(() => calls.filter(c => c.url().includes('interests=')).some(c => new URL(c.url()).searchParams.get('interests') === 'Путешествия и космос')).toBeTruthy();
});

test('занятый период показывает конфликт; успешная бронь доступна для отмены', async ({ page }) => {
  const calls = await backend(page, { conflict: true });
  await page.goto('/'); await login(page);
  await page.getByRole('button', { name: 'Подробнее: Путешествие к звёздам' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Доступно на выбранные даты: 1')).toBeVisible();
  await dialog.getByRole('button', { name: 'Забронировать книгу' }).click();
  await expect(dialog.getByRole('alert')).toContainText('уже занят');
  await expect(dialog.getByRole('button', { name: 'Забронировать книгу' })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Забронировать книгу' }).click();
  await expect(page.getByRole('heading', { name: 'Личный кабинет' })).toBeVisible();
  await expect(page.getByText('Бронь №9 · Экземпляр SPACE-001')).toBeVisible();
  const reservation = calls.find(c => c.method() === 'POST' && c.url().endsWith('/circulation/reservations'))!;
  expect(reservation.headers()['authorization']).toBe('Bearer ui-test-token');
  expect(new Date(reservation.postDataJSON().starts_at).getTime()).toBeGreaterThan(Date.now());
  await page.getByRole('button', { name: 'Отменить бронь', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Отменить бронирование', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Время для новой истории' })).toBeVisible();
  await page.getByRole('button', { name: 'История', exact: true }).click();
  await expect(page.getByText('Отменена', { exact: true })).toBeVisible();
});

test('семантический поиск вызывает нейросетевой API', async ({ page }) => {
  const calls = await backend(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'По смыслу' }).click();
  await page.getByRole('textbox', { name: 'Поиск книг' }).fill('история о дружбе в космосе');
  await page.getByRole('button', { name: 'Найти', exact: true }).click();
  await expect(page.getByText('Подбор для вас', { exact: true })).toBeVisible();
  const search = calls.find(c => c.url().endsWith('/recommendations/search'))!;
  expect(search.postDataJSON()).toEqual({ query: 'история о дружбе в космосе', limit: 50 });
});

test('ошибка нейросети показана без подмены обычным списком', async ({ page }) => {
  await backend(page, { aiUnavailable: true });
  await page.goto('/'); await login(page);
  await page.getByRole('link', { name: 'Мои книги', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Сотруднику нужно обновить индекс книг');
  await expect(page.getByRole('button', { name: 'Подробнее: Путешествие к звёздам' })).toHaveCount(0);
});

test('роль читателя ограничивает рабочие экраны', async ({ page }) => {
  await backend(page);
  await page.goto('/'); await login(page);
  await expect(page.getByRole('link', { name: 'Управление', exact: true })).toHaveCount(0);
  await page.goto('/#admin');
  await expect(page.getByRole('heading', { name: 'Доступ ограничен' })).toBeVisible();
});

test('сотруднику доступны фонд и выдачи; администратору — пользователи', async ({ page }) => {
  await backend(page, { role: 'admin' });
  await page.goto('/'); await login(page);
  await page.getByRole('link', { name: 'Управление', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Книжный фонд' })).toBeVisible();
  await page.getByRole('button', { name: 'Добавить книгу', exact: true }).click();
  await expect(page.getByRole('dialog').getByLabel('Название', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.getByRole('button', { name: 'Выдача и возврат', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Бронирования и выдачи' })).toBeVisible();
  await page.getByRole('link', { name: 'Пользователи', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Учётные записи' })).toBeVisible();
  await expect(page.getByText('other@example.com', { exact: true })).toBeVisible();
});

test('401 завершает сессию и предлагает повторный вход', async ({ page }) => {
  await backend(page, { expireOnReservations: true });
  await page.goto('/'); await login(page);
  await page.getByRole('link', { name: 'Мои книги', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Рады видеть вас снова' })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('list.session'))).toBeNull();
});

test('создание книги отправляет выбранные связи и обновляет нейросетевой индекс', async ({ page }) => {
  const calls = await backend(page, { role: 'staff' });
  await page.goto('/'); await login(page);
  await page.getByRole('link', { name: 'Управление', exact: true }).click();
  await page.getByRole('button', { name: 'Добавить книгу', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Название', { exact: true }).fill('Новая история');
  await dialog.getByLabel('Описание').fill('Книга о путешествиях и новых открытиях');
  await dialog.getByLabel('Ирина Светлова', { exact: true }).check();
  await dialog.getByLabel('Фантастика', { exact: true }).check();
  await dialog.getByRole('button', { name: 'Сохранить книгу' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Новая история', { exact: true })).toBeVisible();
  expect(calls.find(c => c.url().endsWith('/catalog/books') && c.method() === 'POST')!.postDataJSON()).toEqual({ title: 'Новая история', description: 'Книга о путешествиях и новых открытиях', isbn: null, author_ids: [1], genre_ids: [1] });
  await expect.poll(() => calls.filter(c => c.url().endsWith('/recommendations/reindex')).length).toBe(1);
});

test('администратор подтверждает смену роли и блокировку', async ({ page }) => {
  const calls = await backend(page, { role: 'admin' });
  await page.goto('/'); await login(page);
  await page.getByRole('link', { name: 'Пользователи', exact: true }).click();
  await page.getByLabel('Роль other@example.com').selectOption('staff');
  await page.getByRole('dialog').getByRole('button', { name: 'Подтвердить' }).click();
  await expect(page.getByLabel('Роль other@example.com')).toHaveValue('staff');
  expect(calls.find(c => c.url().endsWith('/auth/users/8/role'))!.postDataJSON()).toEqual({ role: 'staff' });
  const row = page.getByRole('row').filter({ hasText: 'other@example.com' });
  await row.getByRole('button', { name: 'Заблокировать' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Подтвердить' }).click();
  await expect(row.getByText('Заблокирован', { exact: true })).toBeVisible();
  expect(calls.find(c => c.url().endsWith('/auth/users/8/state'))!.postDataJSON()).toEqual({ active: false });
});

test('сотрудник выдаёт книгу и регистрирует возврат после подтверждения', async ({ page }) => {
  const calls = await backend(page, { role: 'staff', loanDesk: true });
  await page.goto('/'); await login(page);
  await page.getByRole('link', { name: 'Управление', exact: true }).click();
  await page.getByRole('button', { name: 'Выдача и возврат', exact: true }).click();
  await page.getByRole('button', { name: 'Выдать', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Подтвердить' }).click();
  await expect(page.getByRole('button', { name: 'Принять возврат' })).toBeVisible();
  await page.getByRole('button', { name: 'Принять возврат' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Подтвердить' }).click();
  await expect(page.getByRole('heading', { name: 'Нет подходящих записей' })).toBeVisible();
  expect(calls.some(c => c.method() === 'POST' && c.url().endsWith('/circulation/reservations/9/checkout'))).toBeTruthy();
  expect(calls.some(c => c.method() === 'POST' && c.url().endsWith('/circulation/loans/9/return'))).toBeTruthy();
});
