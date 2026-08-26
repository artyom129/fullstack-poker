from uuid import UUID

import httpx
import pytest

from app.main import app


class FakeRepository:
    def __init__(self) -> None:
        self.hands = {}

    async def create(self, hand):
        self.hands[hand.id] = hand
        return hand

    async def get(self, hand_id: UUID):
        return self.hands.get(hand_id)

    async def list_recent(self):
        return list(reversed(self.hands.values()))


@pytest.fixture
async def client():
    app.state.repository = FakeRepository()
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://test"
    ) as test_client:
        yield test_client


async def test_post_and_get_hands(
    client: httpx.AsyncClient, fold_payload: dict
) -> None:
    response = await client.post("/api/hands", json=fold_payload)
    assert response.status_code == 201
    assert response.json()["id"] == fold_payload["id"]

    response = await client.get("/api/hands")
    assert response.status_code == 200
    assert len(response.json()) == 1
    assert response.json()[0]["shortActionSequence"] == "f f f f f"


async def test_get_hand_resource(client: httpx.AsyncClient, fold_payload: dict) -> None:
    await client.post("/api/hands", json=fold_payload)
    response = await client.get(f"/api/hands/{fold_payload['id']}")
    assert response.status_code == 200
    assert response.json()["winnings"]["2"] == 20


async def test_unknown_hand_returns_404(client: httpx.AsyncClient) -> None:
    response = await client.get("/api/hands/00000000-0000-4000-8000-000000000099")
    assert response.status_code == 404


async def test_invalid_hand_returns_structured_422(
    client: httpx.AsyncClient,
    fold_payload: dict,
) -> None:
    fold_payload["actions"][1]["amount"] = 20
    response = await client.post("/api/hands", json=fold_payload)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_hand"
