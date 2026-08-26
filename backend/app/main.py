import asyncio
import logging
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from uuid import UUID

import asyncpg
from fastapi import Depends, FastAPI, HTTPException, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.domain import Hand
from app.hand_service import HandValidationError, validate_and_settle
from app.repository import HandRepository
from app.schemas import ErrorResponse, HandCreate, HandResponse


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("poker-api")


async def connect_repository(database_url: str) -> tuple[asyncpg.Pool, HandRepository]:
    for attempt in range(1, 31):
        pool: asyncpg.Pool | None = None
        try:
            pool = await asyncpg.create_pool(database_url, min_size=1, max_size=5)
            repository = HandRepository(pool)
            await repository.initialize()
            return pool, repository
        except Exception:
            if pool is not None:
                await pool.close()
            if attempt == 30:
                logger.exception("Database connection failed during startup")
                raise
            logger.warning("Database is not ready; retrying attempt=%s", attempt)
            await asyncio.sleep(1)
    raise RuntimeError("Database connection retry loop exhausted")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    database_url = os.environ.get(
        "DATABASE_URL",
        "postgresql://poker:poker@localhost:5432/poker",
    )
    pool, repository = await connect_repository(database_url)
    app.state.pool = pool
    app.state.repository = repository
    logger.info("Poker API started and database schema is ready")
    yield
    await pool.close()


app = FastAPI(title="Fullstack Poker API", version="1.0.0", lifespan=lifespan)


def get_repository(request: Request) -> HandRepository:
    return request.app.state.repository


def to_response(hand: Hand) -> HandResponse:
    return HandResponse(
        id=hand.id,
        createdAt=hand.created_at,
        startingStack=hand.starting_stack,
        dealerSeat=hand.dealer_seat,
        smallBlindSeat=hand.small_blind_seat,
        bigBlindSeat=hand.big_blind_seat,
        players=hand.players,
        board=hand.board,
        actions=hand.actions,
        shortActionSequence=hand.short_action_sequence,
        winnings=hand.winnings,
        result=hand.result,
    )


@app.exception_handler(HandValidationError)
async def hand_validation_error(
    request: Request,
    exc: HandValidationError,
) -> JSONResponse:
    logger.warning("Hand validation failed path=%s detail=%s", request.url.path, exc)
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={"error": {"code": "invalid_hand", "message": str(exc)}},
    )


@app.exception_handler(RequestValidationError)
async def request_validation_error(
    request: Request,
    exc: RequestValidationError,
) -> JSONResponse:
    logger.warning("Request schema validation failed path=%s", request.url.path)
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={
            "error": {
                "code": "invalid_request",
                "message": "Request body does not match the hand schema",
            }
        },
    )


@app.exception_handler(Exception)
async def unhandled_error(request: Request, exc: Exception) -> JSONResponse:
    logger.error(
        "Unhandled error path=%s",
        request.url.path,
        exc_info=(type(exc), exc, exc.__traceback__),
    )
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "error": {"code": "internal_error", "message": "Internal server error"}
        },
    )


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post(
    "/api/hands",
    response_model=HandResponse,
    status_code=status.HTTP_201_CREATED,
    responses={422: {"model": ErrorResponse}},
)
async def create_hand(
    payload: HandCreate,
    repository: HandRepository = Depends(get_repository),
) -> HandResponse:
    hand = validate_and_settle(payload)
    try:
        await repository.create(hand)
    except asyncpg.UniqueViolationError as exc:
        raise HTTPException(status_code=409, detail="hand already exists") from exc
    except asyncpg.PostgresError:
        logger.exception("Database error while saving hand id=%s", hand.id)
        raise HTTPException(status_code=503, detail="database unavailable") from None
    logger.info("Saved completed hand id=%s", hand.id)
    return to_response(hand)


@app.get("/api/hands", response_model=list[HandResponse])
async def list_hands(
    repository: HandRepository = Depends(get_repository),
) -> list[HandResponse]:
    return [to_response(hand) for hand in await repository.list_recent()]


@app.get(
    "/api/hands/{hand_id}",
    response_model=HandResponse,
    responses={404: {"model": ErrorResponse}},
)
async def get_hand(
    hand_id: UUID,
    repository: HandRepository = Depends(get_repository),
) -> HandResponse:
    hand = await repository.get(hand_id)
    if hand is None:
        raise HTTPException(status_code=404, detail="hand not found")
    return to_response(hand)
