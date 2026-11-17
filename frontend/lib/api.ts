import type { HandState } from "@/lib/poker/engine";
import { handPayload } from "@/lib/poker/engine";
import type { StoredHand } from "@/types/api";

export async function getHands(): Promise<StoredHand[]> {
  const response = await fetch("/api/hands", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Hand history is unavailable");
  }
  return response.json() as Promise<StoredHand[]>;
}

export async function getHand(id: string): Promise<StoredHand> {
  const response = await fetch(`/api/hands/${encodeURIComponent(id)}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(await errorMessage(response, "The saved hand could not be loaded"));
  }
  return response.json() as Promise<StoredHand>;
}

export async function saveHand(state: HandState): Promise<StoredHand> {
  const response = await fetch("/api/hands", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(handPayload(state)),
  });
  if (response.status === 409) {
    // A retry after a lost response: the server already stored this hand.
    return getHand(state.id);
  }
  if (!response.ok) {
    throw new Error(await errorMessage(response, "The completed hand could not be saved"));
  }
  return response.json() as Promise<StoredHand>;
}

async function errorMessage(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as
    | { error?: { message?: string }; detail?: string }
    | null;
  return body?.error?.message ?? body?.detail ?? fallback;
}
