from copy import deepcopy

import pytest
from pydantic import ValidationError

from app.hand_service import HandValidationError, validate_and_settle
from app.schemas import HandCreate


def parse(payload: dict) -> HandCreate:
    return HandCreate.model_validate(payload)


def test_fold_win_payout(fold_payload: dict) -> None:
    hand = validate_and_settle(parse(fold_payload))
    assert hand.winnings == {
        "0": 0,
        "1": -20,
        "2": 20,
        "3": 0,
        "4": 0,
        "5": 0,
    }
    assert hand.result["winnerSeats"] == [2]


def test_coherent_six_way_all_in_showdown(showdown_payload: dict) -> None:
    hand = validate_and_settle(parse(showdown_payload))
    assert hand.winnings == {
        "0": 1_500,
        "1": -300,
        "2": -300,
        "3": -300,
        "4": -300,
        "5": -300,
    }
    assert hand.result["winnerSeats"] == [0]
    assert hand.result["pots"] == [
        {
            "name": "Main pot",
            "amount": 1_800,
            "eligibleSeats": [0, 1, 2, 3, 4, 5],
            "winnerSeats": [0],
        }
    ]


def test_showdown_explains_hand_category(showdown_payload: dict) -> None:
    hand = validate_and_settle(parse(showdown_payload))
    details = {item["seat"]: item["category"] for item in hand.result["hands"]}
    assert details[0] == "Straight"
    assert details[1] == "One pair"


def test_showdown_best_five_uses_short_card_notation(showdown_payload: dict) -> None:
    hand = validate_and_settle(parse(showdown_payload))
    winner = next(item for item in hand.result["hands"] if item["seat"] == 0)
    assert sorted(winner["cards"]) == sorted(["As", "5s", "2c", "3d", "4h"])


def test_duplicate_cards_are_rejected(showdown_payload: dict) -> None:
    payload = deepcopy(showdown_payload)
    payload["players"][1]["holeCards"][0] = payload["players"][0]["holeCards"][0]
    with pytest.raises(HandValidationError, match="unique"):
        validate_and_settle(parse(payload))


def test_claimed_winnings_must_match(showdown_payload: dict) -> None:
    payload = deepcopy(showdown_payload)
    payload["winnings"] = {str(seat): 0 for seat in range(6)}
    with pytest.raises(HandValidationError, match="do not match"):
        validate_and_settle(parse(payload))


def test_winnings_invariant(showdown_payload: dict) -> None:
    hand = validate_and_settle(parse(showdown_payload))
    assert sum(hand.winnings.values()) == 0


def test_negative_stack_is_rejected(fold_payload: dict) -> None:
    payload = deepcopy(fold_payload)
    payload["players"][0]["stack"] = -1
    with pytest.raises(ValidationError):
        parse(payload)


def test_wrong_blind_is_rejected(fold_payload: dict) -> None:
    payload = deepcopy(fold_payload)
    payload["actions"][0]["amount"] = 10
    with pytest.raises(HandValidationError, match="small blind"):
        validate_and_settle(parse(payload))


def test_unfinished_hand_is_rejected(fold_payload: dict) -> None:
    payload = deepcopy(fold_payload)
    payload["completed"] = False
    with pytest.raises(HandValidationError, match="completed"):
        validate_and_settle(parse(payload))


def test_nonzero_stack_cannot_be_marked_all_in(fold_payload: dict) -> None:
    payload = deepcopy(fold_payload)
    payload["players"][0]["allIn"] = True
    with pytest.raises(HandValidationError, match="all-in status"):
        validate_and_settle(parse(payload))


def test_folded_player_cannot_act_again(fold_payload: dict) -> None:
    payload = deepcopy(fold_payload)
    payload["actions"].insert(
        3,
        {"type": "fold", "seat": 3, "label": "Player 4 folds again"},
    )
    with pytest.raises(HandValidationError, match="folded player"):
        validate_and_settle(parse(payload))


def test_all_in_player_cannot_act_again(showdown_payload: dict) -> None:
    payload = deepcopy(showdown_payload)
    payload["actions"].insert(3, deepcopy(payload["actions"][2]))
    with pytest.raises(HandValidationError, match="all-in player"):
        validate_and_settle(parse(payload))


def test_check_while_facing_bet_is_rejected(fold_payload: dict) -> None:
    payload = deepcopy(fold_payload)
    payload["actions"][2] = {
        "type": "check",
        "seat": 3,
        "label": "Player 4 checks",
    }
    with pytest.raises(HandValidationError, match="check is illegal"):
        validate_and_settle(parse(payload))


def test_call_when_nothing_is_owed_is_rejected(fold_payload: dict) -> None:
    payload = deepcopy(fold_payload)
    amounts = {3: 40, 4: 40, 5: 40, 0: 40, 1: 20, 2: 0}
    payload["actions"] = payload["actions"][:2] + [
        {
            "type": "call",
            "seat": seat,
            "amount": amounts[seat],
            "label": f"Player {seat + 1} calls {amounts[seat]}",
        }
        for seat in (3, 4, 5, 0, 1, 2)
    ]
    with pytest.raises(HandValidationError, match="nothing to call"):
        validate_and_settle(parse(payload))


def test_turn_order_is_enforced(fold_payload: dict) -> None:
    payload = deepcopy(fold_payload)
    payload["actions"][2], payload["actions"][3] = (
        payload["actions"][3],
        payload["actions"][2],
    )
    with pytest.raises(HandValidationError, match="turn order"):
        validate_and_settle(parse(payload))


def test_illegal_raise_amount_is_rejected(fold_payload: dict) -> None:
    payload = deepcopy(fold_payload)
    payload["actions"][2] = {
        "type": "raise",
        "seat": 3,
        "amount": 70,
        "label": "Player 4 raises to 70",
    }
    with pytest.raises(HandValidationError, match="raise amount"):
        validate_and_settle(parse(payload))


def test_premature_street_transition_is_rejected(fold_payload: dict) -> None:
    payload = deepcopy(fold_payload)
    payload["actions"].insert(
        2,
        {
            "type": "flop",
            "cards": ["2c", "3d", "4h"],
            "label": "Flop: 2c 3d 4h",
        },
    )
    with pytest.raises(HandValidationError, match="street transition"):
        validate_and_settle(parse(payload))


def test_board_must_match_street_actions(showdown_payload: dict) -> None:
    payload = deepcopy(showdown_payload)
    payload["board"][-1] = "6c"
    with pytest.raises(HandValidationError, match="board does not match"):
        validate_and_settle(parse(payload))


def test_short_action_sequence_is_verified(showdown_payload: dict) -> None:
    payload = deepcopy(showdown_payload)
    payload["shortActionSequence"] = "allin"
    with pytest.raises(HandValidationError, match="short action sequence"):
        validate_and_settle(parse(payload))


def test_terminal_player_state_is_reconstructed(fold_payload: dict) -> None:
    payload = deepcopy(fold_payload)
    payload["players"][0]["stack"] = 960
    payload["players"][0]["committedTotal"] = 40
    payload["players"][1]["stack"] = 1_000
    payload["players"][1]["committedTotal"] = 0
    with pytest.raises(HandValidationError, match="terminal stack"):
        validate_and_settle(parse(payload))


def test_action_after_completion_is_rejected(fold_payload: dict) -> None:
    payload = deepcopy(fold_payload)
    payload["actions"].append({"type": "check", "seat": 2, "label": "Player 3 checks"})
    with pytest.raises(HandValidationError, match="after hand completion"):
        validate_and_settle(parse(payload))


def _shove_payload(fold_payload: dict, stack: int) -> dict:
    payload = deepcopy(fold_payload)
    payload["startingStack"] = stack
    commitments = {1: 20, 2: 40, 3: stack}
    for player in payload["players"]:
        seat = player["seat"]
        player["startingStack"] = stack
        player["committedTotal"] = commitments.get(seat, 0)
        player["stack"] = stack - player["committedTotal"]
        player["folded"] = seat != 3
        player["allIn"] = seat == 3
    payload["actions"] = payload["actions"][:2] + [
        {
            "type": "raise",
            "seat": 3,
            "amount": stack,
            "label": f"Player 4 raises to {stack}",
        },
        *[
            {"type": "fold", "seat": seat, "label": f"Player {seat + 1} folds"}
            for seat in (4, 5, 0, 1, 2)
        ],
    ]
    payload["shortActionSequence"] = f"r{stack} f f f f f"
    return payload


def test_raise_for_whole_stack_off_the_40_grid_is_accepted(fold_payload: dict) -> None:
    hand = validate_and_settle(parse(_shove_payload(fold_payload, 1_010)))
    assert hand.winnings["3"] == 60
    assert hand.winnings["1"] == -20
    assert hand.winnings["2"] == -40


def test_raise_above_the_stack_is_still_rejected(fold_payload: dict) -> None:
    payload = _shove_payload(fold_payload, 1_010)
    payload["actions"][2]["amount"] = 1_050
    payload["shortActionSequence"] = "r1050 f f f f f"
    with pytest.raises(HandValidationError, match="between"):
        validate_and_settle(parse(payload))


def test_folded_blind_does_not_create_a_phantom_side_pot(
    showdown_payload: dict,
) -> None:
    payload = deepcopy(showdown_payload)
    # Seat 1 posts the small blind and folds; everyone else shoves for 300.
    payload["players"][1].update(
        {"stack": 280, "committedTotal": 20, "folded": True, "allIn": False}
    )
    actions = payload["actions"]
    seat1_shove = next(
        index
        for index, action in enumerate(actions)
        if action["type"] == "allin" and action["seat"] == 1
    )
    actions[seat1_shove] = {
        "type": "fold",
        "seat": 1,
        "label": "Player 2 folds",
    }
    payload["shortActionSequence"] = "allin allin allin allin f allin 2c3d4h 8s 9c"

    hand = validate_and_settle(parse(payload))

    assert hand.result["pots"] == [
        {
            "name": "Main pot",
            "amount": 1_520,
            "eligibleSeats": [0, 2, 3, 4, 5],
            "winnerSeats": [0],
        }
    ]
    assert hand.winnings["0"] == 1_220
    assert hand.winnings["1"] == -20


def test_real_side_pot_is_still_split_by_all_in_levels(
    showdown_payload: dict,
) -> None:
    from app.hand_service import calculate_showdown

    payload = parse(showdown_payload)
    players = payload.players
    # Seat 0 (the straight) is all-in short for 100; the rest put in 300.
    players[0].committed_total = 100
    players[0].stack = 200
    _, result = calculate_showdown(players, payload.board, payload.dealer_seat)
    assert [pot["amount"] for pot in result["pots"]] == [600, 1_000]
    assert result["pots"][0]["winnerSeats"] == [0]
    assert result["pots"][1]["eligibleSeats"] == [1, 2, 3, 4, 5]
