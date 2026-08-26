from collections.abc import Callable

import pytest


def _player(
    seat: int,
    *,
    starting_stack: int,
    stack: int,
    committed: int,
    folded: bool,
    all_in: bool,
    cards: list[str],
) -> dict[str, object]:
    return {
        "seat": seat,
        "name": f"Player {seat + 1}",
        "startingStack": starting_stack,
        "stack": stack,
        "committedTotal": committed,
        "holeCards": cards,
        "folded": folded,
        "allIn": all_in,
    }


@pytest.fixture
def fold_payload() -> dict[str, object]:
    cards = [
        ["As", "Ah"],
        ["Ks", "Kh"],
        ["Qs", "Qh"],
        ["Js", "Jh"],
        ["Ts", "Th"],
        ["9s", "9h"],
    ]
    return {
        "id": "00000000-0000-4000-8000-000000000001",
        "completed": True,
        "dealerSeat": 0,
        "smallBlindSeat": 1,
        "bigBlindSeat": 2,
        "startingStack": 1_000,
        "board": [],
        "players": [
            _player(
                seat,
                starting_stack=1_000,
                stack=1_000 - (20 if seat == 1 else 40 if seat == 2 else 0),
                committed=20 if seat == 1 else 40 if seat == 2 else 0,
                folded=seat != 2,
                all_in=False,
                cards=cards[seat],
            )
            for seat in range(6)
        ],
        "actions": [
            {
                "type": "small_blind",
                "seat": 1,
                "amount": 20,
                "label": "Player 2 posts small blind 20",
            },
            {
                "type": "big_blind",
                "seat": 2,
                "amount": 40,
                "label": "Player 3 posts big blind 40",
            },
            *[
                {
                    "type": "fold",
                    "seat": seat,
                    "label": f"Player {seat + 1} folds",
                }
                for seat in (3, 4, 5, 0, 1)
            ],
        ],
        "shortActionSequence": "f f f f f",
        "finishReason": "fold",
        "winnings": None,
    }


@pytest.fixture
def showdown_payload() -> dict[str, object]:
    cards = {
        0: ["As", "5s"],
        1: ["Kh", "Kd"],
        2: ["Qh", "Qd"],
        3: ["Jh", "Jd"],
        4: ["Th", "Td"],
        5: ["7h", "7d"],
    }
    actions: list[dict[str, object]] = [
        {
            "type": "small_blind",
            "seat": 1,
            "amount": 20,
            "label": "Player 2 posts small blind 20",
        },
        {
            "type": "big_blind",
            "seat": 2,
            "amount": 40,
            "label": "Player 3 posts big blind 40",
        },
    ]
    actions.extend(
        {
            "type": "allin",
            "seat": seat,
            "amount": 300,
            "label": f"Player {seat + 1} is all-in for 300",
        }
        for seat in (3, 4, 5, 0, 1, 2)
    )
    actions.extend(
        [
            {
                "type": "flop",
                "cards": ["2c", "3d", "4h"],
                "label": "Flop: 2c 3d 4h",
            },
            {"type": "turn", "cards": ["8s"], "label": "Turn: 8s"},
            {"type": "river", "cards": ["9c"], "label": "River: 9c"},
        ]
    )

    return {
        "id": "00000000-0000-4000-8000-000000000002",
        "completed": True,
        "dealerSeat": 0,
        "smallBlindSeat": 1,
        "bigBlindSeat": 2,
        "startingStack": 300,
        "board": ["2c", "3d", "4h", "8s", "9c"],
        "players": [
            _player(
                seat,
                starting_stack=300,
                stack=0,
                committed=300,
                folded=False,
                all_in=True,
                cards=cards[seat],
            )
            for seat in range(6)
        ],
        "actions": actions,
        "shortActionSequence": ("allin allin allin allin allin allin 2c3d4h 8s 9c"),
        "finishReason": "showdown",
        "winnings": None,
    }


@pytest.fixture
def copy_payload() -> Callable[[dict[str, object]], dict[str, object]]:
    from copy import deepcopy

    return deepcopy
