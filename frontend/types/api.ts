import type { ActionRecord } from "@/lib/poker/engine";

export interface StoredPlayer {
  seat: number;
  name: string;
  startingStack: number;
  stack: number;
  committedTotal: number;
  holeCards: string[];
  folded: boolean;
  allIn: boolean;
}

export interface PotResult {
  name: string;
  amount: number;
  eligibleSeats: number[];
  winnerSeats: number[];
}

export interface HandResult {
  reason: "fold" | "showdown";
  winnerSeats: number[];
  hands: Array<{ seat: number; cards: string[]; category: string }>;
  pots: PotResult[];
}

export interface StoredHand {
  id: string;
  createdAt: string;
  startingStack: number;
  dealerSeat: number;
  smallBlindSeat: number;
  bigBlindSeat: number;
  players: StoredPlayer[];
  board: string[];
  actions: ActionRecord[];
  shortActionSequence: string;
  winnings: Record<string, number>;
  result: HandResult;
}

