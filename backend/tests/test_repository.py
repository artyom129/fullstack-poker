import json
from datetime import UTC, datetime
from uuid import UUID

from app.repository import HandRepository


def test_postgres_jsonb_strings_are_decoded() -> None:
    row = {
        "id": UUID("00000000-0000-4000-8000-000000000010"),
        "created_at": datetime(2026, 1, 1, tzinfo=UTC),
        "starting_stack": 1000,
        "dealer_seat": 0,
        "small_blind_seat": 1,
        "big_blind_seat": 2,
        "players": json.dumps([{"seat": 0, "holeCards": ["As", "Ah"]}]),
        "board": json.dumps([]),
        "actions": json.dumps([{"type": "fold", "seat": 1}]),
        "short_action_sequence": "f",
        "winnings": json.dumps({"0": 20, "1": -20}),
        "result": json.dumps({"reason": "fold", "winners": [0]}),
    }

    hand = HandRepository._to_hand(row)

    assert hand.players[0]["holeCards"] == ["As", "Ah"]
    assert hand.actions[0]["type"] == "fold"
    assert hand.winnings == {"0": 20, "1": -20}
    assert hand.result["winners"] == [0]
