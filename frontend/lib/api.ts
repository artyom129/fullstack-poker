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

export async function saveHand(state: HandState): Promise<StoredHand> {
  const response = await fetch("/api/hands", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(handPayload(state)),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as
      | { error?: { message?: string }; detail?: string }
      | null;
    throw new Error(body?.error?.message ?? body?.detail ?? "The completed hand could not be saved");
  }
  return response.json() as Promise<StoredHand>;
}

