from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


Card = str
ActionType = Literal[
    "small_blind",
    "big_blind",
    "fold",
    "check",
    "call",
    "bet",
    "raise",
    "allin",
    "flop",
    "turn",
    "river",
]


class PlayerSnapshot(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    seat: int = Field(ge=0, le=5)
    name: str = Field(min_length=1, max_length=40)
    starting_stack: int = Field(alias="startingStack", gt=0)
    stack: int = Field(ge=0)
    committed_total: int = Field(alias="committedTotal", ge=0)
    hole_cards: list[Card] = Field(alias="holeCards", min_length=2, max_length=2)
    folded: bool
    all_in: bool = Field(alias="allIn")


class ActionSnapshot(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    type: ActionType
    seat: int | None = Field(default=None, ge=0, le=5)
    amount: int | None = Field(default=None, ge=0)
    cards: list[Card] | None = None
    label: str = Field(min_length=1, max_length=160)

    @model_validator(mode="after")
    def validate_shape(self) -> "ActionSnapshot":
        street_cards = {"flop": 3, "turn": 1, "river": 1}
        if self.type in street_cards:
            if self.cards is None or len(self.cards) != street_cards[self.type]:
                raise ValueError(
                    f"{self.type} requires {street_cards[self.type]} cards"
                )
            if self.seat is not None:
                raise ValueError("street actions cannot have a seat")
        elif self.seat is None:
            raise ValueError("player actions require a seat")
        return self


class HandCreate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: UUID
    starting_stack: int = Field(alias="startingStack", ge=80, le=1_000_000)
    dealer_seat: int = Field(alias="dealerSeat", ge=0, le=5)
    small_blind_seat: int = Field(alias="smallBlindSeat", ge=0, le=5)
    big_blind_seat: int = Field(alias="bigBlindSeat", ge=0, le=5)
    players: list[PlayerSnapshot]
    board: list[Card] = Field(max_length=5)
    actions: list[ActionSnapshot]
    short_action_sequence: str = Field(alias="shortActionSequence", max_length=10_000)
    completed: bool
    finish_reason: Literal["fold", "showdown"] = Field(alias="finishReason")
    winnings: dict[str, int] | None = None

    @field_validator("players")
    @classmethod
    def six_players(cls, players: list[PlayerSnapshot]) -> list[PlayerSnapshot]:
        if len(players) != 6:
            raise ValueError("exactly 6 players are required")
        if {player.seat for player in players} != set(range(6)):
            raise ValueError("player seats must be unique and cover 0 through 5")
        return players


class HandResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, from_attributes=True)

    id: UUID
    created_at: datetime = Field(alias="createdAt")
    starting_stack: int = Field(alias="startingStack")
    dealer_seat: int = Field(alias="dealerSeat")
    small_blind_seat: int = Field(alias="smallBlindSeat")
    big_blind_seat: int = Field(alias="bigBlindSeat")
    players: list[dict[str, object]]
    board: list[str]
    actions: list[dict[str, object]]
    short_action_sequence: str = Field(alias="shortActionSequence")
    winnings: dict[str, int]
    result: dict[str, object]


class ErrorDetail(BaseModel):
    code: str
    message: str


class ErrorResponse(BaseModel):
    error: ErrorDetail
