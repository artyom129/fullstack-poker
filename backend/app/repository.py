import json
from collections.abc import Sequence
from typing import Any
from uuid import UUID

import asyncpg

from app.domain import Hand


CREATE_HANDS_TABLE = """
CREATE TABLE IF NOT EXISTS hands (
    id UUID PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL,
    starting_stack INTEGER NOT NULL,
    dealer_seat SMALLINT NOT NULL,
    small_blind_seat SMALLINT NOT NULL,
    big_blind_seat SMALLINT NOT NULL,
    players JSONB NOT NULL,
    board JSONB NOT NULL,
    actions JSONB NOT NULL,
    short_action_sequence TEXT NOT NULL,
    winnings JSONB NOT NULL,
    result JSONB NOT NULL
)
"""


def decode_json(value: Any) -> Any:
    return json.loads(value) if isinstance(value, str) else value


class HandRepository:
    def __init__(self, pool: asyncpg.Pool) -> None:
        self.pool = pool

    async def initialize(self) -> None:
        await self.pool.execute(CREATE_HANDS_TABLE)

    async def create(self, hand: Hand) -> Hand:
        await self.pool.execute(
            """
            INSERT INTO hands (
                id, created_at, starting_stack, dealer_seat, small_blind_seat,
                big_blind_seat, players, board, actions, short_action_sequence,
                winnings, result
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb,
                $10, $11::jsonb, $12::jsonb
            )
            """,
            hand.id,
            hand.created_at,
            hand.starting_stack,
            hand.dealer_seat,
            hand.small_blind_seat,
            hand.big_blind_seat,
            json.dumps(hand.players),
            json.dumps(hand.board),
            json.dumps(hand.actions),
            hand.short_action_sequence,
            json.dumps(hand.winnings),
            json.dumps(hand.result),
        )
        return hand

    async def get(self, hand_id: UUID) -> Hand | None:
        row = await self.pool.fetchrow(
            "SELECT * FROM hands WHERE id = $1",
            hand_id,
        )
        return self._to_hand(row) if row else None

    async def list_recent(self, limit: int = 30) -> list[Hand]:
        rows = await self.pool.fetch(
            "SELECT * FROM hands ORDER BY created_at DESC LIMIT $1",
            limit,
        )
        return [self._to_hand(row) for row in rows]

    @staticmethod
    def _to_hand(row: Sequence[Any]) -> Hand:
        data = dict(row)
        winnings = decode_json(data["winnings"])
        return Hand(
            id=data["id"],
            created_at=data["created_at"],
            starting_stack=data["starting_stack"],
            dealer_seat=data["dealer_seat"],
            small_blind_seat=data["small_blind_seat"],
            big_blind_seat=data["big_blind_seat"],
            players=decode_json(data["players"]),
            board=decode_json(data["board"]),
            actions=decode_json(data["actions"]),
            short_action_sequence=data["short_action_sequence"],
            winnings={key: int(value) for key, value in winnings.items()},
            result=decode_json(data["result"]),
        )
