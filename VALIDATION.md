# Проверки

Состояние 4 октября 2026 года.

## Фронтенд и единый проект

- `npm install`: зависимости установлены, `package-lock.json` создан; npm сообщил **0 vulnerabilities**.
- `npm run build`: TypeScript и production-сборка React/Vite успешно. JavaScript около 280 KB (84 KB gzip), CSS около 23 KB (6 KB gzip).
- `npm test`: **22 passed**, 18.6 секунды; 11 сценариев на desktop и mobile Chromium. Проверяются каталог без входа, регистрация, авторизация, конфликты и отмена бронирования, нейросетевые API, отсутствие подмены рекомендаций при ошибке, роли, истечение сессии, создание книги и переиндексация, смена ролей/блокировка, выдача/возврат.
- После исправления восстановления фокуса диалогов выполнены 4 дополнительные проверки каталога/рабочих экранов на desktop/mobile: успешно.
- Скриншоты каталога на двух размерах просмотрены. Они используют контролируемые тестовые HTTP-ответы и не являются демонстрацией реального PostgreSQL.
- Изменённый бэкенд: **11 contract-тестов passed**, импорт приложений/OpenAPI и compileall успешно.
- Итоговый `docker compose -f compose.yaml -f compose.test.yaml config --quiet`: успешно. Gateway теперь собирает и раздаёт frontend вместе с proxy API.

**UI-тесты используют route mocks. Полный Docker build и live-сценарий с настоящими PostgreSQL и нейросетью локально не выполнены:** Linux engine Docker по-прежнему недоступен (`dockerDesktopLinuxEngine` pipe отсутствует). `frontend/tests/live.spec.ts` и GitHub Actions подготовлены для настоящего прогона. Запуск всего приложения описан в `FULLSTACK.md`.

## Выполнено

- Установка `requirements.txt` в локальную `.venv`: успешно (Python 3.13.0; контейнеры настроены на Python 3.12).
- `python -m compileall -q app scripts tests`: успешно.
- `python -m scripts.check_imports`: импорт HTTP-приложений и построение всех OpenAPI-схем успешно; Argon2 hash/verify успешно.
- `python -m pytest -v tests/test_contract.py`: **11 passed**, 0.55 секунды; одно предупреждение deprecation из зависимости Starlette/AnyIO.
- `docker compose -f compose.yaml -f compose.test.yaml config --quiet`: успешно.
- `.env` создан с независимыми случайными секретами; значения не выводились в лог.

## Не выполнено

Контейнерный запуск, миграции на реальном PostgreSQL, интеграционные сценарии и реальная нейросетевая модель **не проверены**. После попытки запуска установленного Docker Desktop команда `docker info` всё ещё сообщала об отсутствии pipe `dockerDesktopLinuxEngine`. `docker compose up` завершился до сборки контейнеров по той же причине.

Тесты с PostgreSQL и Mailpit находятся в `tests/test_integration.py`; нейросетевой сценарий включается через `RUN_AI_TESTS=true`. Команды полного прогона приведены в README; GitHub Actions также выполняет полный прогон с моделью. Успешные contract-тесты не подтверждают интеграционную работоспособность всего стека.
