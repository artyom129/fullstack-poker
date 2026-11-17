import { describe, expect, it } from "vitest";

import {
  adjustAmount,
  amountBounds,
  applyAction,
  BIG_BLIND,
  createDeck,
  handPayload,
  randomId,
  shortActionSequence,
  SMALL_BLIND,
  startHand,
  validActions,
  type ActionRecord,
  type HandState,
} from "@/lib/poker/engine";

function fixedDeck(): string[] {
  return [..."23456789TJQKA"].flatMap((rank) => [..."cdhs"].map((suit) => `${rank}${suit}`));
}

function newHand(stack = 1000): HandState {
  return startHand(stack, {
    deck: fixedDeck(),
    dealerSeat: 0,
    id: "00000000-0000-4000-8000-000000000001",
  });
}

function callAroundPreflop(state = newHand()): HandState {
  for (let index = 0; index < 5; index += 1) {
    state = applyAction(state, "call");
  }
  return applyAction(state, "check");
}

function checkAround(state: HandState): HandState {
  for (let index = 0; index < 6; index += 1) {
    state = applyAction(state, "check");
  }
  return state;
}

describe("poker engine", () => {
  it("posts the 20/40 blinds and conserves chips", () => {
    const state = newHand();
    expect(state.players[1].committedTotal).toBe(SMALL_BLIND);
    expect(state.players[2].committedTotal).toBe(BIG_BLIND);
    expect(state.players[1].stack).toBe(980);
    expect(state.players[2].stack).toBe(960);
    expect(state.pot).toBe(60);
  });

  it("acts after the big blind preflop", () => {
    expect(newHand().currentPlayerSeat).toBe(3);
  });

  it("acts left of the dealer postflop", () => {
    expect(callAroundPreflop().currentPlayerSeat).toBe(1);
  });

  it("rejects check when facing a bet", () => {
    const state = newHand();
    expect(validActions(state).has("check")).toBe(false);
    expect(() => applyAction(state, "check")).toThrow("not valid");
  });

  it("rejects call when there is nothing to call", () => {
    const state = callAroundPreflop();
    expect(validActions(state).has("call")).toBe(false);
    expect(() => applyAction(state, "call")).toThrow("not valid");
  });

  it("allows a bet when the street has no bet", () => {
    const state = callAroundPreflop();
    expect(validActions(state).has("bet")).toBe(true);
    expect(applyAction(state, "bet", 40).currentBet).toBe(40);
  });

  it("allows a full raise after a bet", () => {
    let state = callAroundPreflop();
    state = applyAction(state, "bet", 40);
    expect(validActions(state).has("raise")).toBe(true);
    state = applyAction(state, "raise", 80);
    expect(state.currentBet).toBe(80);
    expect(state.minimumRaise).toBe(40);
  });

  it("removes a folded player from future action", () => {
    let state = newHand();
    state = applyAction(state, "fold");
    expect(state.players[3].folded).toBe(true);
    expect(state.currentPlayerSeat).toBe(4);
  });

  it("advances only after every active player settles", () => {
    let state = newHand();
    for (let index = 0; index < 5; index += 1) state = applyAction(state, "call");
    expect(state.street).toBe("preflop");
    state = applyAction(state, "check");
    expect(state.street).toBe("flop");
  });

  it("deals exactly three cards on the flop", () => {
    expect(callAroundPreflop().board).toHaveLength(3);
  });

  it("deals one additional card on the turn", () => {
    const state = checkAround(callAroundPreflop());
    expect(state.street).toBe("turn");
    expect(state.board).toHaveLength(4);
  });

  it("deals one additional card on the river", () => {
    let state = checkAround(callAroundPreflop());
    state = checkAround(state);
    expect(state.street).toBe("river");
    expect(state.board).toHaveLength(5);
  });

  it("never repeats dealt cards", () => {
    let state = checkAround(callAroundPreflop());
    state = checkAround(state);
    const cards = [...state.players.flatMap((player) => player.holeCards), ...state.board];
    expect(new Set(cards).size).toBe(cards.length);
  });

  it("finishes immediately when one player remains", () => {
    let state = newHand();
    for (let index = 0; index < 5; index += 1) state = applyAction(state, "fold");
    expect(state.completed).toBe(true);
    expect(state.finishReason).toBe("fold");
    expect(state.board).toHaveLength(0);
    expect(Object.values(state.winnings ?? {}).reduce((sum, value) => sum + value, 0)).toBe(0);
  });

  it("skips an all-in player in later action", () => {
    let state = newHand(80);
    state = applyAction(state, "allin");
    expect(state.players[3].allIn).toBe(true);
    expect(state.currentPlayerSeat).toBe(4);
  });

  it("runs the board to showdown when everyone is all-in", () => {
    let state = newHand(80);
    for (let index = 0; index < 6; index += 1) state = applyAction(state, "allin");
    expect(state.completed).toBe(true);
    expect(state.finishReason).toBe("showdown");
    expect(state.street).toBe("river");
    expect(state.board).toHaveLength(5);
  });

  it("never lets a stack become negative", () => {
    let state = newHand(80);
    for (let index = 0; index < 6; index += 1) state = applyAction(state, "allin");
    expect(state.players.every((player) => player.stack >= 0)).toBe(true);
  });

  it("rejects an invalid raise amount", () => {
    expect(() => applyAction(newHand(), "raise", 60)).toThrow("between");
  });

  it("increments amount controls by the 40-chip big blind", () => {
    const bounds = { minimum: 40, maximum: 200 };
    expect(adjustAmount(40, 1, bounds)).toBe(80);
    expect(adjustAmount(80, -1, bounds)).toBe(40);
  });

  it("clamps amount controls to the current stack", () => {
    const bounds = { minimum: 40, maximum: 100 };
    expect(adjustAmount(80, 1, bounds)).toBe(100);
    expect(adjustAmount(100, 1, bounds)).toBe(100);
  });

  it("generates the specified short action sequence", () => {
    const actions: ActionRecord[] = [
      { type: "call", seat: 0, amount: 40, label: "call" },
      { type: "fold", seat: 1, label: "fold" },
      { type: "raise", seat: 2, amount: 120, label: "raise" },
      { type: "check", seat: 0, label: "check" },
      { type: "flop", cards: ["As", "Kd", "7h"], label: "flop" },
      { type: "bet", seat: 0, amount: 80, label: "bet" },
      { type: "allin", seat: 2, amount: 300, label: "all-in" },
    ];
    expect(shortActionSequence(actions)).toBe("c f r120 x AsKd7h b80 allin");
  });

  it("creates a clean state on reset", () => {
    const first = applyAction(newHand(), "call");
    const reset = newHand();
    expect(reset.actions).toHaveLength(2);
    expect(reset.board).toEqual([]);
    expect(reset.pot).toBe(60);
    expect(reset.actions).not.toEqual(first.actions);
  });

  it("exports only completed hands", () => {
    expect(() => handPayload(newHand())).toThrow("completed");
  });

  it("sets legal raise bounds from the current bet and stack", () => {
    expect(amountBounds(newHand())).toEqual({ minimum: 80, maximum: 1000 });
  });

  it("creates a full unique production deck", () => {
    const deck = createDeck();
    expect(deck).toHaveLength(52);
    expect(new Set(deck).size).toBe(52);
  });

  it("allows raising the whole stack when it is off the 40-chip grid", () => {
    const state = newHand(1010);
    const bounds = amountBounds(state);
    expect(bounds.maximum).toBe(1010);
    const raised = applyAction(state, "raise", adjustAmount(980, 1, bounds));
    expect(raised.currentBet).toBe(1010);
    expect(raised.players[3].allIn).toBe(true);
    expect(raised.actions.at(-1)?.type).toBe("raise");
  });

  it("creates v4 ids without crypto.randomUUID (plain HTTP on a LAN address)", () => {
    const original = crypto.randomUUID;
    Object.defineProperty(crypto, "randomUUID", { value: undefined, configurable: true });
    try {
      const id = randomId();
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(startHand(1000).id).not.toBe(id);
    } finally {
      Object.defineProperty(crypto, "randomUUID", { value: original, configurable: true });
    }
  });
});
