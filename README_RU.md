# Fullstack Poker

[English](README.md) | **Русский**

## Обзор

Riverline симулирует одну полную раздачу six-player no-limit Texas Hold'em. Один пользователь управляет действиями всех игроков от preflop до showdown. Завершённая раздача валидируется, рассчитывается и автоматически сохраняется, после чего доступна в Hand History через REST API.

## Стек

- Next.js, React, strict TypeScript, shadcn/ui;
- FastAPI, Python 3.12, Poetry, PokerKit;
- PostgreSQL 16, asyncpg, parameterized raw SQL;
- Docker Compose, Vitest, pytest, Ruff, ESLint, Playwright.

## Запуск

```bash
docker compose up -d
```

Открыть:

- App: `http://localhost:3000`
- API: `http://localhost:8000`
- Swagger: `http://localhost:8000/docs`

Backend создаёт схему базы при старте. Дополнительный `.env`, ручной install, migration command или отдельная настройка БД для стандартного Docker-запуска не нужны.

## Архитектура

Frontend владеет интерактивной state machine: проверяет допустимые действия, раздаёт карты и ведёт action log. На showdown он отправляет завершённый snapshot backend'у.

Backend:

1. проверяет важные invariants;
2. восстанавливает последовательность действий;
3. через PokerKit заново рассчитывает комбинации и main/side pots;
4. сохраняет immutable settled snapshot в PostgreSQL.

Победа через fold рассчитывается на клиенте и независимо проверяется сервером.

PostgreSQL хранит ресурс `hands`. Players, actions, board, winnings и result snapshots сохраняются в JSONB, потому что завершённая история раздачи immutable и обычно читается целиком.

## API

- `GET /api/hands`
- `GET /api/hands/{id}`
- `POST /api/hands`
- `GET /health`

## Тестирование

Backend:

```bash
cd backend
poetry install
poetry run pytest
poetry run ruff check .
```

Frontend:

```bash
cd frontend
npm ci
npm run test
npm run lint
npm run typecheck
npm run build
```

E2E при запущенном Docker Compose:

```bash
cd frontend
npx playwright install chromium
npm run test:e2e
```

## Дополнительные возможности

- **Hand Replay** — пошаговое воспроизведение blinds, действий, street cards и результата;
- **Explainable Showdown** — показывает категории комбинаций и победителей main/side pots.

## Технические решения

- raw SQL изолирован внутри `HandRepository`;
- API routes не содержат persistence mapping;
- pure frontend state machine позволяет тестировать poker transitions без React rendering;
- JSONB используется для компактного immutable snapshot;
- PokerKit 0.7.4 отвечает за сравнение комбинаций;
- server validation проверяет порядок действий, betting, chip transitions, streets и completion до сохранения результата.

Проект демонстрирует full-stack разработку, state-machine design, backend validation, PostgreSQL/JSONB, Docker и многоуровневое тестирование.
