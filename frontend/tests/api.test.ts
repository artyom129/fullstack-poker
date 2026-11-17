import { afterEach, describe, expect, it, vi } from "vitest";

import { saveHand } from "@/lib/api";
import { applyAction, startHand, type HandState } from "@/lib/poker/engine";

function foldedHand(): HandState {
  let state = startHand(1000, { dealerSeat: 0, id: "00000000-0000-4000-8000-000000000042" });
  for (let index = 0; index < 5; index += 1) state = applyAction(state, "fold");
  return state;
}

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("saveHand", () => {
  it("treats 409 on a retry as saved and loads the stored hand", async () => {
    const stored = { id: "00000000-0000-4000-8000-000000000042" };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ error: { code: "hand_exists", message: "hand already exists" } }, 409))
      .mockResolvedValueOnce(json(stored, 200));
    vi.stubGlobal("fetch", fetchMock);

    await expect(saveHand(foldedHand())).resolves.toEqual(stored);
    expect(fetchMock.mock.calls[1][0]).toBe("/api/hands/00000000-0000-4000-8000-000000000042");
  });

  it("surfaces the server validation message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(json({ error: { code: "invalid_hand", message: "board does not match" } }, 422)),
    );
    await expect(saveHand(foldedHand())).rejects.toThrow("board does not match");
  });
});
