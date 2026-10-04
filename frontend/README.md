# Фронтенд «Лист»

Основные инструкции по запуску фронтенда и бэкенда вместе находятся в [FULLSTACK.md](../FULLSTACK.md).

```sh
npm ci
npm run dev
```

Vite: `http://127.0.0.1:5173`, API proxy: `http://127.0.0.1:8080`. Полный проект запускается из корня: `docker compose up -d --build`, затем откройте `http://localhost:8080`.

Проверки: `npm run build`, `npx playwright install chromium`, `npm test`. Тесты UI используют контролируемые HTTP-ответы, а `npm run test:live` работает с настоящим стеком и требует учётные данные тестового администратора. Подробности — в FULLSTACK.md.
