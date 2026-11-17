from collections import defaultdict
from dataclasses import dataclass, field
from datetime import UTC, datetime

from pokerkit import StandardHighHand

from app.domain import Hand
from app.schemas import ActionSnapshot, HandCreate, PlayerSnapshot


PLAYER_COUNT = 6
SMALL_BLIND = 20
BIG_BLIND = 40
PLAYER_ACTIONS = {"fold", "check", "call", "bet", "raise", "allin"}
STREETS = ("flop", "turn", "river")


class HandValidationError(ValueError):
    pass


@dataclass(slots=True)
class ValidationPlayer:
    stack: int
    committed_this_street: int = 0
    committed_total: int = 0
    folded: bool = False
    all_in: bool = False
    acted_this_street: bool = False


@dataclass(slots=True)
class ValidationState:
    players: list[ValidationPlayer]
    dealer_seat: int
    street: str = "preflop"
    current_player_seat: int | None = None
    current_bet: int = BIG_BLIND
    minimum_raise: int = BIG_BLIND
    board: list[str] = field(default_factory=list)
    pending_streets: list[str] = field(default_factory=list)
    running_out: bool = False
    completed: bool = False
    finish_reason: str | None = None


def calculate_showdown(
    players: list[PlayerSnapshot],
    board: list[str],
    dealer_seat: int,
) -> tuple[dict[str, int], dict[str, object]]:
    if len(board) != 5:
        raise HandValidationError("showdown requires a five-card board")

    hands = {
        player.seat: StandardHighHand.from_game(
            "".join(player.hole_cards),
            "".join(board),
        )
        for player in players
        if not player.folded
    }
    awards: defaultdict[int, int] = defaultdict(int)
    pots: list[dict[str, object]] = []
    # Pot boundaries come only from players still in the hand. A folded player's
    # chips are dead money inside those pots; their commitment level must not
    # open a separate "side pot" of its own.
    levels = sorted(
        {
            player.committed_total
            for player in players
            if not player.folded and player.committed_total
        }
    )
    if not levels:
        raise HandValidationError("a pot has no eligible player")
    if max(player.committed_total for player in players) > levels[-1]:
        raise HandValidationError("a folded player cannot outbid every contender")
    previous = 0

    for index, level in enumerate(levels):
        amount = sum(
            min(player.committed_total, level) - min(player.committed_total, previous)
            for player in players
        )
        previous = level
        eligible = [
            player
            for player in players
            if not player.folded and player.committed_total >= level
        ]

        best = max(hands[player.seat] for player in eligible)
        winners = [player for player in eligible if hands[player.seat] == best]
        share, remainder = divmod(amount, len(winners))
        ordered_winners = sorted(
            winners,
            key=lambda player: (player.seat - dealer_seat - 1) % PLAYER_COUNT,
        )
        for winner_index, winner in enumerate(ordered_winners):
            awards[winner.seat] += share + (winner_index < remainder)

        pots.append(
            {
                "name": "Main pot" if index == 0 else f"Side pot {index}",
                "amount": amount,
                "eligibleSeats": [player.seat for player in eligible],
                "winnerSeats": [player.seat for player in ordered_winners],
            }
        )

    return _build_result(players, hands, awards, pots)


def calculate_fold_win(
    players: list[PlayerSnapshot],
) -> tuple[dict[str, int], dict[str, object]]:
    remaining = [player for player in players if not player.folded]
    if len(remaining) != 1:
        raise HandValidationError("fold finish requires exactly one active player")
    winner = remaining[0]
    pot = sum(player.committed_total for player in players)
    awards = defaultdict(int, {winner.seat: pot})
    winnings, _ = _build_result(players, {}, awards, [])
    result: dict[str, object] = {
        "reason": "fold",
        "winnerSeats": [winner.seat],
        "hands": [],
        "pots": [
            {
                "name": "Pot",
                "amount": pot,
                "eligibleSeats": [winner.seat],
                "winnerSeats": [winner.seat],
            }
        ],
    }
    return winnings, result


def validate_and_settle(payload: HandCreate) -> Hand:
    _validate_snapshot(payload)
    if payload.finish_reason == "showdown":
        winnings, result = calculate_showdown(
            payload.players,
            payload.board,
            payload.dealer_seat,
        )
    else:
        winnings, result = calculate_fold_win(payload.players)

    if payload.winnings is not None and payload.winnings != winnings:
        raise HandValidationError("claimed winnings do not match the cards and pots")
    if sum(winnings.values()) != 0:
        raise HandValidationError("winnings must sum to zero")

    return Hand(
        id=payload.id,
        created_at=datetime.now(UTC),
        starting_stack=payload.starting_stack,
        dealer_seat=payload.dealer_seat,
        small_blind_seat=payload.small_blind_seat,
        big_blind_seat=payload.big_blind_seat,
        players=[player.model_dump(by_alias=True) for player in payload.players],
        board=payload.board,
        actions=[action.model_dump(by_alias=True) for action in payload.actions],
        short_action_sequence=payload.short_action_sequence,
        winnings=winnings,
        result=result,
    )


def _validate_snapshot(payload: HandCreate) -> None:
    if not payload.completed:
        raise HandValidationError("only completed hands can be saved")
    if payload.small_blind_seat != (payload.dealer_seat + 1) % PLAYER_COUNT:
        raise HandValidationError("small blind seat is invalid")
    if payload.big_blind_seat != (payload.dealer_seat + 2) % PLAYER_COUNT:
        raise HandValidationError("big blind seat is invalid")

    _validate_cards(payload)
    for player in payload.players:
        if player.starting_stack != payload.starting_stack:
            raise HandValidationError("player starting stacks must match the hand")
        if player.stack + player.committed_total != player.starting_stack:
            raise HandValidationError("player chip accounting is invalid")
        if player.all_in != (player.stack == 0):
            raise HandValidationError("all-in status must match a zero stack")
        if player.folded and player.all_in:
            raise HandValidationError("a folded player cannot also be all-in")

    state = _reconstruct_actions(payload)
    if state.board != payload.board:
        raise HandValidationError("board does not match street action cards")
    if state.finish_reason != payload.finish_reason:
        raise HandValidationError("finish reason does not match the action history")
    expected_sequence = _short_action_sequence(payload.actions)
    if payload.short_action_sequence != expected_sequence:
        raise HandValidationError("short action sequence does not match the actions")
    _validate_terminal_players(payload.players, state.players)


def _validate_cards(payload: HandCreate) -> None:
    cards = [card for player in payload.players for card in player.hole_cards]
    cards.extend(payload.board)
    valid_cards = {f"{rank}{suit}" for rank in "23456789TJQKA" for suit in "cdhs"}
    if any(card not in valid_cards for card in cards):
        raise HandValidationError("cards must use standard rank/suit notation")
    if len(cards) != len(set(cards)):
        raise HandValidationError("cards must be unique")


def _reconstruct_actions(payload: HandCreate) -> ValidationState:
    if len(payload.actions) < 2:
        raise HandValidationError("action history must begin with both blinds")
    _validate_blind(
        payload.actions[0],
        "small_blind",
        payload.small_blind_seat,
        SMALL_BLIND,
    )
    _validate_blind(
        payload.actions[1],
        "big_blind",
        payload.big_blind_seat,
        BIG_BLIND,
    )

    state = ValidationState(
        players=[ValidationPlayer(payload.starting_stack) for _ in range(6)],
        dealer_seat=payload.dealer_seat,
    )
    _commit(state.players[payload.small_blind_seat], SMALL_BLIND)
    _commit(state.players[payload.big_blind_seat], BIG_BLIND)
    state.current_player_seat = _find_next_player(
        state.players,
        payload.big_blind_seat,
    )

    for action in payload.actions[2:]:
        if state.completed:
            raise HandValidationError("no action is allowed after hand completion")
        if state.pending_streets:
            _consume_street_action(state, action)
            continue
        if action.type in STREETS:
            raise HandValidationError(
                "street transition occurred before the betting round completed"
            )
        if action.type not in PLAYER_ACTIONS:
            raise HandValidationError("blind actions are only valid at hand start")
        _apply_player_action(state, action)
        _advance_after_action(state)

    if state.pending_streets:
        raise HandValidationError(
            f"action history is missing the {state.pending_streets[0]} action"
        )
    if not state.completed:
        raise HandValidationError("action history does not complete the hand")
    if state.finish_reason == "showdown" and len(state.board) != 5:
        raise HandValidationError("showdown requires flop, turn, and river actions")
    return state


def _validate_blind(
    action: ActionSnapshot,
    action_type: str,
    seat: int,
    amount: int,
) -> None:
    if (
        action.type != action_type
        or action.seat != seat
        or action.amount != amount
        or action.cards is not None
    ):
        blind_name = "small blind" if action_type == "small_blind" else "big blind"
        raise HandValidationError(f"{blind_name} must be {amount}")


def _apply_player_action(
    state: ValidationState,
    action: ActionSnapshot,
) -> None:
    if action.seat is None:
        raise HandValidationError("player action requires a seat")
    player = state.players[action.seat]
    if player.folded:
        raise HandValidationError("a folded player cannot act again")
    if player.all_in or player.stack == 0:
        raise HandValidationError("an all-in player cannot act again")
    if action.seat != state.current_player_seat:
        raise HandValidationError("player action seats do not follow turn order")
    if action.cards is not None:
        raise HandValidationError("player actions cannot contain board cards")

    to_call = state.current_bet - player.committed_this_street
    if action.type == "fold":
        _require_no_amount(action)
        player.folded = True
        player.acted_this_street = True
    elif action.type == "check":
        _require_no_amount(action)
        if to_call != 0:
            raise HandValidationError("check is illegal while facing a bet")
        player.acted_this_street = True
    elif action.type == "call":
        if to_call <= 0:
            raise HandValidationError("call is illegal when there is nothing to call")
        paid = min(player.stack, to_call)
        if action.amount != paid:
            raise HandValidationError("call amount does not match the betting state")
        _commit(player, paid)
        player.acted_this_street = True
    elif action.type in {"bet", "raise"}:
        _apply_aggressive_action(state, player, action)
    elif action.type == "allin":
        _apply_all_in(state, player, action)
    else:
        raise HandValidationError("invalid player action")

    state.current_player_seat = action.seat


def _require_no_amount(action: ActionSnapshot) -> None:
    if action.amount is not None:
        raise HandValidationError(f"{action.type} action must not have an amount")


def _apply_aggressive_action(
    state: ValidationState,
    player: ValidationPlayer,
    action: ActionSnapshot,
) -> None:
    expected_type = "bet" if state.current_bet == 0 else "raise"
    if action.type != expected_type:
        raise HandValidationError(
            f"{action.type} is illegal for the current betting state"
        )
    minimum = (
        BIG_BLIND if state.current_bet == 0 else state.current_bet + state.minimum_raise
    )
    maximum = player.committed_this_street + player.stack
    target = action.amount
    if target is None or target < minimum or target > maximum:
        raise HandValidationError(
            f"{action.type} amount must be between {minimum} and {maximum}"
        )

    previous_bet = state.current_bet
    _commit(player, target - player.committed_this_street)
    state.current_bet = target
    state.minimum_raise = target - previous_bet
    _reset_responses(state.players, state.current_player_seat)
    player.acted_this_street = True


def _apply_all_in(
    state: ValidationState,
    player: ValidationPlayer,
    action: ActionSnapshot,
) -> None:
    target = player.committed_this_street + player.stack
    if action.amount != target:
        raise HandValidationError("all-in amount does not match the player's stack")

    acting_seat = action.seat
    previous_bet = state.current_bet
    _commit(player, player.stack)
    player.acted_this_street = True
    if target <= previous_bet:
        return

    raise_size = target - previous_bet
    state.current_bet = target
    if raise_size >= state.minimum_raise:
        state.minimum_raise = raise_size
        _reset_responses(state.players, acting_seat)
    else:
        for seat, opponent in enumerate(state.players):
            if (
                seat != acting_seat
                and not opponent.folded
                and not opponent.all_in
                and opponent.committed_this_street < target
            ):
                opponent.acted_this_street = False


def _advance_after_action(state: ValidationState) -> None:
    contenders = [player for player in state.players if not player.folded]
    if len(contenders) == 1:
        state.completed = True
        state.finish_reason = "fold"
        state.current_player_seat = None
        return

    if not _betting_round_complete(state):
        acting_seat = state.current_player_seat
        if acting_seat is None:
            raise HandValidationError("action history has no acting player")
        state.current_player_seat = _find_next_player(state.players, acting_seat)
        return

    decision_players = [
        player
        for player in state.players
        if not player.folded and not player.all_in and player.stack > 0
    ]
    if state.street == "river" or len(decision_players) <= 1:
        start = 0 if state.street == "preflop" else STREETS.index(state.street) + 1
        state.pending_streets = list(STREETS[start:])
        state.running_out = True
        state.current_player_seat = None
        if not state.pending_streets:
            state.completed = True
            state.finish_reason = "showdown"
        return

    next_street = (
        STREETS[0]
        if state.street == "preflop"
        else STREETS[STREETS.index(state.street) + 1]
    )
    state.pending_streets = [next_street]
    state.running_out = False
    state.current_player_seat = None


def _consume_street_action(
    state: ValidationState,
    action: ActionSnapshot,
) -> None:
    expected = state.pending_streets[0]
    if action.type != expected:
        raise HandValidationError(f"expected {expected} after the betting round")
    if action.amount is not None or action.seat is not None or action.cards is None:
        raise HandValidationError(f"{expected} action has invalid fields")

    state.pending_streets.pop(0)
    state.board.extend(action.cards)
    state.street = expected
    if state.running_out:
        if not state.pending_streets:
            state.completed = True
            state.finish_reason = "showdown"
        return

    for player in state.players:
        player.committed_this_street = 0
        player.acted_this_street = False
    state.current_bet = 0
    state.minimum_raise = BIG_BLIND
    state.current_player_seat = _find_next_player(
        state.players,
        state.dealer_seat,
    )


def _betting_round_complete(state: ValidationState) -> bool:
    return all(
        player.folded
        or player.all_in
        or (
            player.acted_this_street
            and player.committed_this_street == state.current_bet
        )
        for player in state.players
    )


def _find_next_player(
    players: list[ValidationPlayer],
    from_seat: int,
) -> int | None:
    for offset in range(1, PLAYER_COUNT + 1):
        seat = (from_seat + offset) % PLAYER_COUNT
        player = players[seat]
        if not player.folded and not player.all_in and player.stack > 0:
            return seat
    return None


def _commit(player: ValidationPlayer, amount: int) -> None:
    if amount < 0 or amount > player.stack:
        raise HandValidationError("chip commitment is outside the player's stack")
    player.stack -= amount
    player.committed_this_street += amount
    player.committed_total += amount
    player.all_in = player.stack == 0


def _reset_responses(
    players: list[ValidationPlayer],
    acting_seat: int | None,
) -> None:
    for seat, player in enumerate(players):
        if seat != acting_seat and not player.folded and not player.all_in:
            player.acted_this_street = False


def _short_action_sequence(actions: list[ActionSnapshot]) -> str:
    parts: list[str] = []
    for action in actions:
        if action.type == "fold":
            parts.append("f")
        elif action.type == "check":
            parts.append("x")
        elif action.type == "call":
            parts.append("c")
        elif action.type == "bet":
            parts.append(f"b{action.amount}")
        elif action.type == "raise":
            parts.append(f"r{action.amount}")
        elif action.type == "allin":
            parts.append("allin")
        elif action.type in STREETS and action.cards is not None:
            parts.append("".join(action.cards))
    return " ".join(parts)


def _validate_terminal_players(
    submitted: list[PlayerSnapshot],
    reconstructed: list[ValidationPlayer],
) -> None:
    for player in submitted:
        actual = reconstructed[player.seat]
        terminal = (
            player.stack,
            player.committed_total,
            player.folded,
            player.all_in,
        )
        expected = (
            actual.stack,
            actual.committed_total,
            actual.folded,
            actual.all_in,
        )
        if terminal != expected:
            raise HandValidationError(
                f"terminal stack or commitment mismatch for seat {player.seat}"
            )


def _build_result(
    players: list[PlayerSnapshot],
    hands: dict[int, StandardHighHand],
    awards: defaultdict[int, int],
    pots: list[dict[str, object]],
) -> tuple[dict[str, int], dict[str, object]]:
    winnings = {
        str(player.seat): player.stack + awards[player.seat] - player.starting_stack
        for player in players
    }
    winner_seats = sorted(seat for seat, amount in awards.items() if amount > 0)
    hand_details = [
        {
            "seat": seat,
            # str(card) is "ACE OF SPADES (As)"; store the same short notation as
            # the rest of the snapshot.
            "cards": [f"{card.rank.value}{card.suit.value}" for card in hand.cards],
            "category": hand.entry.label.value,
        }
        for seat, hand in sorted(hands.items())
    ]
    return winnings, {
        "reason": "showdown",
        "winnerSeats": winner_seats,
        "hands": hand_details,
        "pots": pots,
    }
