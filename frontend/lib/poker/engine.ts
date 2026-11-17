export const PLAYER_COUNT = 6;
export const SMALL_BLIND = 20;
export const BIG_BLIND = 40;

export type Street = "preflop" | "flop" | "turn" | "river";
export type PlayerAction = "fold" | "check" | "call" | "bet" | "raise" | "allin";
export type ActionType =
  | PlayerAction
  | "small_blind"
  | "big_blind"
  | "flop"
  | "turn"
  | "river";

export interface PlayerState {
  seat: number;
  name: string;
  startingStack: number;
  stack: number;
  committedThisStreet: number;
  committedTotal: number;
  holeCards: string[];
  folded: boolean;
  allIn: boolean;
  actedThisStreet: boolean;
}

export interface ActionRecord {
  type: ActionType;
  seat?: number;
  amount?: number;
  cards?: string[];
  label: string;
}

export interface HandState {
  id: string;
  startingStack: number;
  street: Street;
  players: PlayerState[];
  dealerSeat: number;
  smallBlindSeat: number;
  bigBlindSeat: number;
  currentPlayerSeat: number | null;
  currentBet: number;
  minimumRaise: number;
  pot: number;
  board: string[];
  actions: ActionRecord[];
  deck: string[];
  completed: boolean;
  finishReason: "fold" | "showdown" | null;
  winnings: Record<string, number> | null;
}

export interface StartOptions {
  deck?: string[];
  dealerSeat?: number;
  id?: string;
}

export interface AmountBounds {
  minimum: number;
  maximum: number;
}

const RANKS = "23456789TJQKA";
const SUITS = "cdhs";

export function createDeck(): string[] {
  const deck = [...RANKS].flatMap((rank) => [...SUITS].map((suit) => `${rank}${suit}`));
  const random = new Uint32Array(1);
  for (let index = deck.length - 1; index > 0; index -= 1) {
    crypto.getRandomValues(random);
    const swapIndex = random[0] % (index + 1);
    [deck[index], deck[swapIndex]] = [deck[swapIndex], deck[index]];
  }
  return deck;
}

export function startHand(startingStack: number, options: StartOptions = {}): HandState {
  if (!Number.isInteger(startingStack) || startingStack < 80) {
    throw new Error("Starting stack must be an integer of at least 80 chips");
  }

  const dealerSeat = options.dealerSeat ?? randomSeat();
  const smallBlindSeat = (dealerSeat + 1) % PLAYER_COUNT;
  const bigBlindSeat = (dealerSeat + 2) % PLAYER_COUNT;
  const deck = [...(options.deck ?? createDeck())];
  if (new Set(deck).size !== deck.length || deck.length < 17) {
    throw new Error("Deck must contain at least 17 unique cards");
  }

  const players: PlayerState[] = Array.from({ length: PLAYER_COUNT }, (_, seat) => ({
    seat,
    name: `Player ${seat + 1}`,
    startingStack,
    stack: startingStack,
    committedThisStreet: 0,
    committedTotal: 0,
    holeCards: [],
    folded: false,
    allIn: false,
    actedThisStreet: false,
  }));

  for (let pass = 0; pass < 2; pass += 1) {
    for (const player of players) {
      player.holeCards.push(draw(deck));
    }
  }

  const actions: ActionRecord[] = [];
  postBlind(players[smallBlindSeat], SMALL_BLIND, "small_blind", actions);
  postBlind(players[bigBlindSeat], BIG_BLIND, "big_blind", actions);

  return {
    id: options.id ?? randomId(),
    startingStack,
    street: "preflop",
    players,
    dealerSeat,
    smallBlindSeat,
    bigBlindSeat,
    currentPlayerSeat: findNextPlayer(players, bigBlindSeat),
    currentBet: BIG_BLIND,
    minimumRaise: BIG_BLIND,
    pot: SMALL_BLIND + BIG_BLIND,
    board: [],
    actions,
    deck,
    completed: false,
    finishReason: null,
    winnings: null,
  };
}

export function validActions(state: HandState): Set<PlayerAction> {
  if (state.completed || state.currentPlayerSeat === null) {
    return new Set();
  }
  const player = state.players[state.currentPlayerSeat];
  if (player.folded || player.allIn || player.stack === 0) {
    return new Set();
  }

  const actions = new Set<PlayerAction>(["fold", "allin"]);
  const toCall = state.currentBet - player.committedThisStreet;
  if (toCall === 0) {
    actions.add("check");
  } else {
    actions.add("call");
  }

  const bounds = amountBounds(state);
  if (bounds.minimum <= bounds.maximum) {
    actions.add(state.currentBet === 0 ? "bet" : "raise");
  }
  return actions;
}

export function amountBounds(state: HandState): AmountBounds {
  if (state.currentPlayerSeat === null) {
    return { minimum: 0, maximum: 0 };
  }
  const player = state.players[state.currentPlayerSeat];
  return {
    minimum: state.currentBet === 0 ? BIG_BLIND : state.currentBet + state.minimumRaise,
    maximum: player.committedThisStreet + player.stack,
  };
}

export function adjustAmount(
  amount: number,
  direction: -1 | 1,
  bounds: AmountBounds,
): number {
  const next = amount + direction * BIG_BLIND;
  return Math.min(bounds.maximum, Math.max(bounds.minimum, next));
}

export function applyAction(
  original: HandState,
  type: PlayerAction,
  amount?: number,
): HandState {
  if (original.currentPlayerSeat === null) {
    throw new Error("The hand is not waiting for an action");
  }
  if (!validActions(original).has(type)) {
    throw new Error(`${type} is not valid for the current player`);
  }

  const seat = original.currentPlayerSeat;
  const state = cloneState(original);
  const player = state.players[seat];

  if (type === "fold") {
    player.folded = true;
    player.actedThisStreet = true;
    addPlayerAction(state, type, seat, undefined, `${player.name} folds`);
  } else if (type === "check") {
    player.actedThisStreet = true;
    addPlayerAction(state, type, seat, undefined, `${player.name} checks`);
  } else if (type === "call") {
    const paid = commitChips(player, state.currentBet - player.committedThisStreet);
    state.pot += paid;
    player.actedThisStreet = true;
    addPlayerAction(state, type, seat, paid, `${player.name} calls ${paid}`);
  } else if (type === "bet" || type === "raise") {
    applyAggressiveAction(state, player, type, amount);
  } else {
    applyAllIn(state, player);
  }

  return advanceAfterAction(state, seat);
}

export function shortActionSequence(actions: ActionRecord[]): string {
  return actions
    .flatMap((action) => {
      if (action.type === "fold") return ["f"];
      if (action.type === "check") return ["x"];
      if (action.type === "call") return ["c"];
      if (action.type === "bet") return [`b${action.amount}`];
      if (action.type === "raise") return [`r${action.amount}`];
      if (action.type === "allin") return ["allin"];
      if (action.cards) return [action.cards.join("")];
      return [];
    })
    .join(" ");
}

export function handPayload(state: HandState) {
  if (!state.completed || state.finishReason === null) {
    throw new Error("Only a completed hand can be saved");
  }
  return {
    id: state.id,
    startingStack: state.startingStack,
    dealerSeat: state.dealerSeat,
    smallBlindSeat: state.smallBlindSeat,
    bigBlindSeat: state.bigBlindSeat,
    players: state.players.map((player) => ({
      seat: player.seat,
      name: player.name,
      startingStack: player.startingStack,
      stack: player.stack,
      committedTotal: player.committedTotal,
      holeCards: player.holeCards,
      folded: player.folded,
      allIn: player.allIn,
    })),
    board: state.board,
    actions: state.actions,
    shortActionSequence: shortActionSequence(state.actions),
    completed: true,
    finishReason: state.finishReason,
    winnings: state.winnings,
  };
}

function applyAggressiveAction(
  state: HandState,
  player: PlayerState,
  type: "bet" | "raise",
  target: number | undefined,
) {
  const bounds = amountBounds(state);
  if (
    target === undefined ||
    !Number.isInteger(target) ||
    target < bounds.minimum ||
    target > bounds.maximum
  ) {
    throw new Error(`${type} amount must be between ${bounds.minimum} and ${bounds.maximum}`);
  }

  const previousBet = state.currentBet;
  const paid = commitChips(player, target - player.committedThisStreet);
  state.pot += paid;
  state.currentBet = target;
  state.minimumRaise = target - previousBet;
  resetResponses(state.players, player.seat);
  player.actedThisStreet = true;
  addPlayerAction(
    state,
    type,
    player.seat,
    target,
    `${player.name} ${type === "bet" ? "bets" : "raises to"} ${target}`,
  );
}

function applyAllIn(state: HandState, player: PlayerState) {
  const previousBet = state.currentBet;
  const target = player.committedThisStreet + player.stack;
  const paid = commitChips(player, player.stack);
  state.pot += paid;
  player.actedThisStreet = true;

  if (target > previousBet) {
    const raiseSize = target - previousBet;
    state.currentBet = target;
    if (raiseSize >= state.minimumRaise) {
      state.minimumRaise = raiseSize;
      resetResponses(state.players, player.seat);
    } else {
      for (const opponent of state.players) {
        if (
          opponent.seat !== player.seat &&
          !opponent.folded &&
          !opponent.allIn &&
          opponent.committedThisStreet < target
        ) {
          opponent.actedThisStreet = false;
        }
      }
    }
  }
  addPlayerAction(state, "allin", player.seat, target, `${player.name} is all-in for ${target}`);
}

function advanceAfterAction(state: HandState, actingSeat: number): HandState {
  const contenders = state.players.filter((player) => !player.folded);
  if (contenders.length === 1) {
    const winner = contenders[0];
    state.completed = true;
    state.finishReason = "fold";
    state.currentPlayerSeat = null;
    state.winnings = Object.fromEntries(
      state.players.map((player) => [
        String(player.seat),
        player.stack + (player.seat === winner.seat ? state.pot : 0) - player.startingStack,
      ]),
    );
    return state;
  }

  if (!bettingRoundComplete(state)) {
    state.currentPlayerSeat = findNextPlayer(state.players, actingSeat);
    return state;
  }

  const playersWithDecisions = state.players.filter(
    (player) => !player.folded && !player.allIn && player.stack > 0,
  );
  if (state.street === "river" || playersWithDecisions.length <= 1) {
    return runOut(state);
  }
  return advanceStreet(state);
}

function bettingRoundComplete(state: HandState): boolean {
  return state.players.every(
    (player) =>
      player.folded ||
      player.allIn ||
      (player.actedThisStreet && player.committedThisStreet === state.currentBet),
  );
}

function advanceStreet(state: HandState): HandState {
  const nextStreet: Record<Exclude<Street, "river">, Exclude<Street, "preflop">> = {
    preflop: "flop",
    flop: "turn",
    turn: "river",
  };
  const street = nextStreet[state.street as Exclude<Street, "river">];
  dealStreet(state, street);
  for (const player of state.players) {
    player.committedThisStreet = 0;
    player.actedThisStreet = false;
  }
  state.street = street;
  state.currentBet = 0;
  state.minimumRaise = BIG_BLIND;
  state.currentPlayerSeat = findNextPlayer(state.players, state.dealerSeat);
  return state;
}

function runOut(state: HandState): HandState {
  const remaining: Exclude<Street, "preflop">[] = ["flop", "turn", "river"];
  const start = state.street === "preflop" ? 0 : state.street === "flop" ? 1 : state.street === "turn" ? 2 : 3;
  for (const street of remaining.slice(start)) {
    dealStreet(state, street);
    state.street = street;
  }
  state.completed = true;
  state.finishReason = "showdown";
  state.currentPlayerSeat = null;
  state.winnings = null;
  return state;
}

function dealStreet(state: HandState, street: Exclude<Street, "preflop">) {
  const count = street === "flop" ? 3 : 1;
  const cards = Array.from({ length: count }, () => draw(state.deck));
  state.board.push(...cards);
  state.actions.push({
    type: street,
    cards,
    label: `${street[0].toUpperCase()}${street.slice(1)}: ${cards.join(" ")}`,
  });
}

function commitChips(player: PlayerState, requested: number): number {
  const paid = Math.min(player.stack, Math.max(0, requested));
  player.stack -= paid;
  player.committedThisStreet += paid;
  player.committedTotal += paid;
  player.allIn = player.stack === 0;
  return paid;
}

function postBlind(
  player: PlayerState,
  amount: number,
  type: "small_blind" | "big_blind",
  actions: ActionRecord[],
) {
  const paid = commitChips(player, amount);
  actions.push({
    type,
    seat: player.seat,
    amount: paid,
    label: `${player.name} posts ${type === "small_blind" ? "small" : "big"} blind ${paid}`,
  });
}

function resetResponses(players: PlayerState[], actingSeat: number) {
  for (const player of players) {
    if (player.seat !== actingSeat && !player.folded && !player.allIn) {
      player.actedThisStreet = false;
    }
  }
}

function findNextPlayer(players: PlayerState[], fromSeat: number): number | null {
  for (let offset = 1; offset <= PLAYER_COUNT; offset += 1) {
    const seat = (fromSeat + offset) % PLAYER_COUNT;
    const player = players[seat];
    if (!player.folded && !player.allIn && player.stack > 0) {
      return seat;
    }
  }
  return null;
}

function addPlayerAction(
  state: HandState,
  type: PlayerAction,
  seat: number,
  amount: number | undefined,
  label: string,
) {
  state.actions.push({ type, seat, amount, label });
}

function cloneState(state: HandState): HandState {
  return {
    ...state,
    players: state.players.map((player) => ({ ...player, holeCards: [...player.holeCards] })),
    board: [...state.board],
    actions: state.actions.map((action) => ({
      ...action,
      cards: action.cards ? [...action.cards] : undefined,
    })),
    deck: [...state.deck],
    winnings: state.winnings ? { ...state.winnings } : null,
  };
}

function draw(deck: string[]): string {
  const card = deck.shift();
  if (!card) throw new Error("Deck is empty");
  return card;
}

/** RFC 4122 v4 id. `crypto.randomUUID` exists only in secure contexts, so the app
 * crashed on Start when opened over plain HTTP on a LAN address. */
export function randomId(): string {
  if (typeof crypto.randomUUID === "function") {
    try {
      return crypto.randomUUID();
    } catch {
      // fall through to the manual version
    }
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function randomSeat(): number {
  const random = new Uint32Array(1);
  crypto.getRandomValues(random);
  return random[0] % PLAYER_COUNT;
}

