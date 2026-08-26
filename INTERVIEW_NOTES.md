# Interview Notes

## Game state

`HandState` contains the six players, positions, street, current actor/bet, minimum raise, pot, board, remaining deck, log, and completion result. Each `PlayerState` keeps stack plus street and total commitments. `applyAction` is pure from React's perspective: it clones the previous state, validates the requested action, applies chips, then chooses the next transition.

The UI calls `validActions` and disables illegal controls. `applyAction` checks the same rules again, so disabled buttons are not the security boundary.

## Betting-round completion

A round is complete when every non-folded, non-all-in player has acted after the latest full raise and has matched `currentBet`. A bet or full raise clears other active players' acted flags. A short all-in increases the amount that undercalled players must match but keeps the existing minimum full-raise size.

On a street change, street commitments, acted flags, and the current bet reset. Total commitments remain because they determine pots.

## Action order

With dealer seat `D`, small blind is `D + 1`, big blind is `D + 2`, and preflop begins at `D + 3`, all modulo six. Postflop begins with the first active seat left of the dealer. The circular lookup always skips folded and all-in players.

## All-in and runout

All-in commits `min(stack, required amount)` and never makes a stack negative. An all-in player remains eligible for every pot covered by their total commitment but receives no further turns. When no meaningful decisions remain, the engine deals missing streets immediately and marks the hand ready for server settlement.

## Side pots and PokerKit

The backend sorts distinct commitment levels. Each level creates a pot slice: level delta multiplied by the number of contributors who reached it. Folded contributors add chips but are not eligible. PokerKit's `StandardHighHand.from_game` evaluates every eligible player's best Hold'em hand. Each slice goes to the strongest eligible hand, split evenly on ties; odd chips follow seat order left of the dealer.

PokerKit is pinned because evaluator APIs can change. A prototype against 0.7.4 confirmed `from_game`, ordering comparisons, selected cards, and `entry.label.value`. Our code handles state and pot construction, not poker-hand ranking.

## Validation boundary

The browser is authoritative only for interaction. `POST /api/hands` accepts a completed snapshot, then the server checks six seats, standard unique cards, two hole cards each, board length, blinds 20/40, non-negative stacks, chip conservation, completion reason, and claimed fold payout. Showdown awards are always recalculated with PokerKit. Only the validated result is stored.

Validation is intentionally invariant-based rather than a second line-by-line copy of the frontend state machine.

## Repository and storage

`HandRepository` exposes `create`, `get`, and `list_recent`. It owns parameterized asyncpg SQL and row/dataclass mapping; routes do not contain SQL and the repository contains no poker rules.

One `hands` row holds scalar search/display fields and JSONB snapshots. A completed hand is immutable and read as a whole, so JSONB is clearer than a large normalized action/card schema for this scope.

## Docker startup

Compose starts PostgreSQL first and waits for `pg_isready`. FastAPI then creates the table idempotently and exposes `/health`. The frontend waits for backend health and proxies browser `/api/*` requests to `http://backend:8000`; container traffic never uses localhost. Externally the app is available on ports 3000 and 8000.

## What I would improve next

With more time I would add server-side action replay from the submitted log. Current validation proves the important terminal invariants and independently settles payouts, which matches the assignment, but replay would also prove that every intermediate action and street transition was legal. I would share conformance fixtures between TypeScript and Python rather than duplicate the full engine.
