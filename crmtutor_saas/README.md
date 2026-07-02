# CRM Tutor SaaS

Новый сервис находится отдельно от старого miniapp. Исходный проект не меняется: копия кода лежит в `legacy_miniapp_snapshot`, копия базы лежит в `data/imported_legacy.sqlite3`.

## Что реализовано

- коммерческая multi-tenant архитектура: все CRM-таблицы имеют `workspace_id`;
- самостоятельная регистрация репетитора на сайте через кнопку `Создать кабинет репетитора`;
- автоматическое создание workspace, роли владельца и публичной страницы `crmtutor.ru/username`;
- роли `platform_admin`, `tutor`, `teacher`, `student`, `parent`;
- тарифы `Free`, `Pro`, `School`, subscription model, billing events и ограничения по тарифам;
- публичная страница репетитора с фото, описанием, предметами, направлениями, стоимостью и заявкой;
- заявки учеников попадают в CRM;
- инвайты для учеников, родителей и преподавателей;
- единый backend API для сайта и будущего Telegram Mini App;
- авторизация только через Telegram или Email OTP. SMS не используется никогда;
- финансовый журнал: ручные оплаты, предоплаты, автоматические списания занятий, возвраты и корректировки заложены типами операций;
- автоматическое списание предоплаченного занятия при переводе урока в `conducted`;
- календарь с 30-минутной сеткой;
- white label задел: отдельная таблица для домена, логотипа и цветов.

## Локальный запуск

```bash
cd crmtutor_saas
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env
./run_dev.sh
```

Открыть: `http://127.0.0.1:8001`.

При первом старте сервис импортирует `data/imported_legacy.sqlite3` в workspace `fedor`. Повторный импорт не дублирует данные, если workspace уже существует.

## Деплой на crmtutor.ru

1. На сервере установить Docker и Docker Compose.
2. Скопировать каталог `crmtutor_saas` на сервер.
3. Создать `.env` из `.env.example` и заменить `JWT_SECRET`.
4. Убедиться, что DNS `crmtutor.ru` и `www.crmtutor.ru` указывают на сервер.
5. Первый запуск для HTTP challenge:

```bash
docker compose up -d app nginx
DOMAIN=crmtutor.ru LETSENCRYPT_EMAIL=admin@crmtutor.ru ./scripts/init_ssl.sh
docker compose up -d
```

6. Для продления сертификатов добавить cron:

```bash
0 3 * * * cd /path/to/crmtutor_saas && docker compose run --rm certbot renew && docker compose restart nginx
```

## Архитектура

- `src/crmtutor_saas/app.py` — FastAPI API и web routes.
- `src/crmtutor_saas/storage.py` — multi-tenant SQLite schema, тарифы, billing, импорт legacy.
- `src/crmtutor_saas/security.py` — HMAC JWT-like access token, refresh token, OTP helpers.
- `src/crmtutor_saas/web/static` — mobile-first web UI.
- `deploy/nginx/crmtutor.conf` — Nginx для `crmtutor.ru`.
- `docker-compose.yml` — app, nginx, certbot.

Для масштаба 1000+ репетиторов и 100000+ учеников схема уже отделяет tenant-данные по `workspace_id` и содержит индексы по основным запросам. Следующий production-шаг после MVP: заменить SQLite на PostgreSQL без изменения API-контрактов, добавить Alembic-миграции, очередь уведомлений и настоящий email provider.
