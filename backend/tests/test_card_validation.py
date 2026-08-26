from copy import deepcopy

import pytest

from app.hand_service import HandValidationError, validate_and_settle
from app.schemas import HandCreate


def test_non_standard_card_is_rejected(showdown_payload: dict) -> None:
    payload = deepcopy(showdown_payload)
    payload["board"][0] = "1x"
    with pytest.raises(HandValidationError, match="standard rank/suit"):
        validate_and_settle(HandCreate.model_validate(payload))
