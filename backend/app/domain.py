from dataclasses import dataclass
from datetime import datetime
from typing import Any
from uuid import UUID


@dataclass(slots=True)
class Hand:
    id: UUID
    created_at: datetime
    starting_stack: int
    dealer_seat: int
    small_blind_seat: int
    big_blind_seat: int
    players: list[dict[str, Any]]
    board: list[str]
    actions: list[dict[str, Any]]
    short_action_sequence: str
    winnings: dict[str, int]
    result: dict[str, Any]
