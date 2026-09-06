**English** | [Русский](README_RU.md)

# Fullstack Poker

## Overview

Riverline simulates one complete six-player no-limit Texas Hold'em hand. One user acts for every player from preflop through showdown. Completed hands are validated, settled, and saved automatically, then loaded into Hand History through REST.

## Stack

- Next.js, React, strict TypeScript, shadcn/ui components
- FastAPI, Python 3.12, Poetry, PokerKit
- PostgreSQL 16, asyncpg, parameterized raw SQL
- Docker Compose, Vitest, pytest, Ruff, ESLint, Playwright

## Run

```bash
docker compose up -d
```

Open:

- App: http://localhost:3000
- API: http://localhost:8000
- Swagger: http://localhost:8000/docs

The database schema is created by the backend on startup. No environment file, migration command, package install, or database setup is required.

## Architecture

The frontend owns the interactive state machine, action validation, dealing, and action log. At showdown it submits the completed snapshot; the backend verifies important invariants, uses PokerKit to recalculate hands and main/side pots, and persists the settled immutable snapshot. Fold wins are calculated immediately in the client and independently checked by the server.

PostgreSQL stores a single `hands` resource. Player, action, board, winnings, and result snapshots use JSONB because completed histories are immutable and always read as a unit.

## API

- `GET /api/hands`
- `GET /api/hands/{id}`
- `POST /api/hands`
- `GET /health`

## Testing

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

E2E, with Docker Compose running:

```bash
cd frontend
npx playwright install chromium
npm run test:e2e
```

## Extra features

- **Hand Replay** steps through blinds, actions, street cards, and the final result.
- **Explainable Showdown** shows hand categories and main/side-pot winners.

## Technical decisions

- Raw SQL stays inside `HandRepository`; API routes contain no persistence mapping.
- A pure frontend state machine keeps poker transitions testable without rendering React.
- JSONB models a compact immutable hand snapshot without unnecessary normalized tables.
- PokerKit 0.7.4 is pinned and owns hand comparison; no custom evaluator is maintained.
- Server validation reconstructs action order, betting, chip transitions, streets, completion, and the compact action sequence before settling cards and pots.

