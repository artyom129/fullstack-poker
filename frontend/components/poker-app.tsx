"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, History, ListOrdered, Minus, Plus, RotateCcw, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getHands, saveHand } from "@/lib/api";
import {
  adjustAmount,
  amountBounds,
  applyAction,
  BIG_BLIND,
  type ActionRecord,
  type HandState,
  type PlayerAction,
  SMALL_BLIND,
  startHand,
  validActions,
} from "@/lib/poker/engine";
import { cn } from "@/lib/utils";
import type { StoredHand } from "@/types/api";

type SaveStatus = "idle" | "saving" | "saved" | "error";

const ACTION_ORDER: PlayerAction[] = ["fold", "check", "call", "bet", "raise", "allin"];
const ACTION_LABEL: Record<PlayerAction, string> = {
  fold: "Fold",
  check: "Check",
  call: "Call",
  bet: "Bet",
  raise: "Raise",
  allin: "All-in",
};
const STREET_NAME: Record<string, string> = {
  preflop: "Preflop",
  flop: "Flop",
  turn: "Turn",
  river: "River",
};

const chips = new Intl.NumberFormat("en-US");
const fmt = (value: number) => chips.format(value);
const signed = (value: number) => (value > 0 ? `+${fmt(value)}` : value < 0 ? `−${fmt(-value)}` : "0");

export function PokerApp() {
  const [startingStack, setStartingStack] = useState("1000");
  const [hand, setHand] = useState<HandState | null>(null);
  const [amount, setAmount] = useState(BIG_BLIND);
  const [history, setHistory] = useState<StoredHand[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [settledHand, setSettledHand] = useState<StoredHand | null>(null);
  const [replay, setReplay] = useState<{ hand: StoredHand; step: number } | null>(null);
  const submittedIds = useRef(new Set<string>());

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      setHistory(await getHands());
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : "Hand history is unavailable");
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    if (!hand || !hand.completed || submittedIds.current.has(hand.id)) return;
    submittedIds.current.add(hand.id);
    setSaveStatus("saving");
    setSaveError(null);
    void saveHand(hand)
      .then((saved) => {
        setSettledHand(saved);
        setHistory((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
        setSaveStatus("saved");
      })
      .catch((error: unknown) => {
        submittedIds.current.delete(hand.id);
        setSaveError(error instanceof Error ? error.message : "The hand could not be saved");
        setSaveStatus("error");
      });
  }, [hand]);

  const bounds = useMemo(() => (hand ? amountBounds(hand) : { minimum: 40, maximum: 40 }), [hand]);
  const available = useMemo(() => (hand ? validActions(hand) : new Set<PlayerAction>()), [hand]);

  useEffect(() => {
    if (bounds.minimum > 0) setAmount(bounds.minimum);
  }, [bounds.minimum, bounds.maximum]);

  function beginHand() {
    const stack = Number(startingStack);
    if (!Number.isInteger(stack) || stack < 80) return;
    setHand(startHand(stack));
    setSettledHand(null);
    setSaveStatus("idle");
    setSaveError(null);
    setActionError(null);
  }

  function act(action: PlayerAction) {
    if (!hand) return;
    try {
      setHand(applyAction(hand, action, action === "bet" || action === "raise" ? amount : undefined));
      setActionError(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Invalid action");
    }
  }

  function retrySave() {
    if (!hand) return;
    submittedIds.current.delete(hand.id);
    setHand({ ...hand });
  }

  const startDisabled = !Number.isInteger(Number(startingStack)) || Number(startingStack) < 80;
  const resetReady = hand !== null && hand.actions.length > 2;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="dealer-puck brand-puck" aria-hidden="true">D</span>
          <h1>Riverline</h1>
          <span className="brand-note">Hold&apos;em hand lab</span>
        </div>
        <dl className="table-terms">
          <div><dt>Seats</dt><dd>6</dd></div>
          <div><dt>Game</dt><dd>No-limit</dd></div>
          <div><dt>Blinds</dt><dd>{SMALL_BLIND}/{BIG_BLIND}</dd></div>
        </dl>
      </header>

      <section className="workspace">
        <aside className="side-panel log-panel">
          <PanelHeading icon={<ListOrdered size={16} strokeWidth={1.5} />} title="Play log" meta={hand ? `${hand.actions.length} events` : ""} />
          <div className="scroll-area" data-testid="play-log">
            {hand ? (
              <PlayLog actions={hand.actions} />
            ) : (
              <EmptyState title="No hand in progress" detail="Set the starting stack and deal" />
            )}
          </div>
        </aside>

        <section className="table-column">
          <div className="control-strip">
            <label className="stack-field">
              <span>Starting stack</span>
              <Input
                aria-label="Starting stack"
                data-testid="starting-stack"
                inputMode="numeric"
                min={80}
                step={40}
                value={startingStack}
                onChange={(event) => setStartingStack(event.target.value)}
              />
            </label>
            <Button
              data-testid="start-reset"
              variant={resetReady ? "outline" : "default"}
              disabled={startDisabled || (hand !== null && !resetReady)}
              onClick={beginHand}
            >
              {resetReady ? <RotateCcw size={16} strokeWidth={1.5} /> : null}
              {resetReady ? "Reset" : "Start"}
            </Button>
          </div>

          <div className="table-stage">
            <div className="table-rail">
              <div className="felt">
                {hand ? (
                  <>
                    <div className="table-readout">
                      <span className="street-name">{STREET_NAME[hand.street]}</span>
                      <strong className="pot-figure"><span>Pot</span>{fmt(hand.pot)}</strong>
                      <div className="board" aria-label="Community cards">
                        {Array.from({ length: 5 }, (_, index) => (
                          <PlayingCard key={index} card={hand.board[index]} size="board" />
                        ))}
                      </div>
                    </div>
                    {hand.completed
                      ? null
                      : hand.players.map((player) =>
                          player.committedThisStreet > 0 ? (
                            <span key={`bet-${player.seat}`} className={cn("bet-stack", `bet-${player.seat}`)}>
                              <i aria-hidden="true" />
                              {fmt(player.committedThisStreet)}
                            </span>
                          ) : null,
                        )}
                    <span className={cn("dealer-puck table-puck", `puck-${hand.dealerSeat}`)} aria-label="Dealer button">D</span>
                  </>
                ) : (
                  <div className="table-empty">
                    <strong>Table is set</strong>
                    <span>Six seats, blinds {SMALL_BLIND}/{BIG_BLIND}</span>
                  </div>
                )}
              </div>
            </div>
            {hand ? (
              <div className="seats">
                {hand.players.map((player) => (
                  <PlayerSeat
                    key={player.seat}
                    player={player}
                    active={hand.currentPlayerSeat === player.seat}
                    smallBlind={hand.smallBlindSeat === player.seat}
                    bigBlind={hand.bigBlindSeat === player.seat}
                    dealer={hand.dealerSeat === player.seat}
                    net={settledHand?.id === hand.id ? settledHand.winnings[String(player.seat)] : undefined}
                  />
                ))}
              </div>
            ) : null}
          </div>

          <ActionConsole
            hand={hand}
            amount={amount}
            bounds={bounds}
            available={available}
            saveStatus={saveStatus}
            saveError={saveError}
            actionError={actionError}
            settledHand={settledHand}
            onAmount={setAmount}
            onAction={act}
            onRetrySave={retrySave}
          />
        </section>

        <aside className="side-panel history-panel">
          <PanelHeading icon={<History size={16} strokeWidth={1.5} />} title="Hand history" meta={`${history.length} saved`} />
          <div className="scroll-area history-scroll" data-testid="hand-history">
            {historyLoading ? (
              <EmptyState title="Loading history" detail="Reading saved hands" />
            ) : historyError ? (
              <div className="error-state">
                <p>{historyError}</p>
                <Button size="sm" variant="outline" onClick={() => void loadHistory()}>Retry</Button>
              </div>
            ) : history.length === 0 ? (
              <EmptyState title="No saved hands" detail="Finished hands are settled by the server and land here" />
            ) : (
              history.map((saved) => (
                <HistoryCard key={saved.id} hand={saved} onReplay={() => setReplay({ hand: saved, step: 0 })} />
              ))
            )}
          </div>
        </aside>
      </section>

      {replay ? <ReplayOverlay replay={replay} onChange={setReplay} onClose={() => setReplay(null)} /> : null}
    </main>
  );
}

function PanelHeading({ icon, title, meta }: { icon: React.ReactNode; title: string; meta: string }) {
  return (
    <div className="panel-heading">
      <div>{icon}<h2>{title}</h2></div>
      <span>{meta}</span>
    </div>
  );
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  );
}

function verb(action: ActionRecord): string {
  switch (action.type) {
    case "small_blind": return "small blind";
    case "big_blind": return "big blind";
    case "fold": return "folds";
    case "check": return "checks";
    case "call": return "calls";
    case "bet": return "bets";
    case "raise": return "raises to";
    case "allin": return "all-in for";
    default: return action.label;
  }
}

function PlayLog({ actions }: { actions: ActionRecord[] }) {
  return (
    <ol className="event-list">
      {actions.map((action, index) =>
        action.cards ? (
          <li key={`${index}-${action.label}`} className="street-row">
            <span>{STREET_NAME[action.type]}</span>
            <span className="street-cards">
              {action.cards.map((card) => <PlayingCard key={card} card={card} size="mini" />)}
            </span>
          </li>
        ) : (
          <li key={`${index}-${action.label}`} className={cn("event", action.type === "fold" && "event-fold")}>
            <span className="seat-tag">P{(action.seat ?? 0) + 1}</span>
            <span className="event-verb">{verb(action)}</span>
            <span className="event-amount">{action.amount != null ? fmt(action.amount) : ""}</span>
          </li>
        ),
      )}
    </ol>
  );
}

function PlayerSeat({
  player,
  active,
  dealer,
  smallBlind,
  bigBlind,
  net,
}: {
  player: HandState["players"][number];
  active: boolean;
  dealer: boolean;
  smallBlind: boolean;
  bigBlind: boolean;
  net?: number;
}) {
  const role = dealer ? "Dealer" : smallBlind ? "SB" : bigBlind ? "BB" : "";
  return (
    <div
      className={cn("player-seat", `seat-${player.seat}`, active && "active-seat", player.folded && "folded-seat")}
      data-testid={`player-${player.seat}`}
      aria-current={active ? "true" : undefined}
    >
      <div className="seat-topline">
        <span className="seat-name">{player.name}</span>
        <span className="seat-role">{role}</span>
      </div>
      <div className="seat-body">
        <div className="seat-numbers">
          <span>Stack <strong>{player.stack}</strong></span>
          <span>In pot <strong>{player.committedTotal}</strong></span>
        </div>
        <div className="hole-cards">
          {player.holeCards.map((card) => <PlayingCard key={card} card={card} size="seat" />)}
        </div>
      </div>
      <div className="seat-state">
        {active ? <span className="to-act">To act</span> : null}
        {player.allIn ? <span>All-in</span> : null}
        {player.folded ? <span>Folded</span> : null}
        {net !== undefined ? <span className={cn("net", net > 0 && "net-up", net < 0 && "net-down")}>{signed(net)}</span> : null}
      </div>
    </div>
  );
}

const SUIT_SYMBOL: Record<string, string> = { h: "♥", d: "♦", c: "♣", s: "♠" };

// Hands saved before the server stored short notation hold "ACE OF SPADES (As)".
function shortCard(card: string): string {
  return card.length > 2 ? (/\(([2-9TJQKA][cdhs])\)/.exec(card)?.[1] ?? card) : card;
}

function PlayingCard({ card: raw, size }: { card?: string; size: "board" | "seat" | "mini" }) {
  const card = raw ? shortCard(raw) : undefined;
  if (!card) return <span className={cn("playing-card card-slot", `card-${size}`)} />;
  const suit = card[1];
  const rank = card[0] === "T" ? "10" : card[0];
  return (
    <span className={cn("playing-card", `card-${size}`, (suit === "h" || suit === "d") && "red-card")} aria-label={card}>
      <b>{rank}</b>
      <i>{SUIT_SYMBOL[suit]}</i>
    </span>
  );
}

function buttonLabel(action: PlayerAction, enabled: boolean, toCall: number, player: HandState["players"][number], amount: number) {
  if (!enabled) return ACTION_LABEL[action];
  if (action === "call") return `Call ${fmt(Math.min(toCall, player.stack))}`;
  if (action === "allin") return `All-in ${fmt(player.stack + player.committedThisStreet)}`;
  if (action === "bet" || action === "raise") return `${ACTION_LABEL[action]} to ${fmt(amount)}`;
  return ACTION_LABEL[action];
}

function ActionConsole({
  hand,
  amount,
  bounds,
  available,
  saveStatus,
  saveError,
  actionError,
  settledHand,
  onAmount,
  onAction,
  onRetrySave,
}: {
  hand: HandState | null;
  amount: number;
  bounds: { minimum: number; maximum: number };
  available: Set<PlayerAction>;
  saveStatus: SaveStatus;
  saveError: string | null;
  actionError: string | null;
  settledHand: StoredHand | null;
  onAmount: (amount: number) => void;
  onAction: (action: PlayerAction) => void;
  onRetrySave: () => void;
}) {
  if (!hand) {
    return <div className="action-console console-empty">Start a hand, then act for each seat in turn</div>;
  }
  if (hand.completed) {
    return (
      <div className="action-console completed-console" data-testid="hand-completed">
        <div className="settle-head">
          <div>
            <span className="control-label">Hand complete</span>
            <strong>{hand.finishReason === "fold" ? "Won without showdown" : "Showdown settled by the server"}</strong>
          </div>
          <div className={cn("save-state", `save-${saveStatus}`)}>
            {saveStatus === "saving" ? "Validating and saving" : saveStatus === "saved" ? "Saved to history" : saveStatus === "error" ? saveError : "Preparing result"}
          </div>
          {saveStatus === "error" ? <Button size="sm" variant="outline" onClick={onRetrySave}>Retry save</Button> : null}
        </div>
        {settledHand ? <ResultSummary hand={settledHand} /> : null}
      </div>
    );
  }

  const player = hand.players[hand.currentPlayerSeat ?? 0];
  const toCall = Math.max(0, hand.currentBet - player.committedThisStreet);
  const sizing = available.has("bet") || available.has("raise");
  return (
    <div className="action-console">
      <div className="actor">
        <span className="control-label">Action on</span>
        <strong>{player.name}</strong>
        <span className="to-call">To call <b>{fmt(toCall)}</b></span>
      </div>
      <div className="action-buttons">
        {ACTION_ORDER.map((action) => (
          <Button
            key={action}
            data-testid={`action-${action}`}
            variant={action === "bet" || action === "raise" ? "accent" : "outline"}
            disabled={!available.has(action)}
            onClick={() => onAction(action)}
          >
            {buttonLabel(action, available.has(action), toCall, player, amount)}
          </Button>
        ))}
      </div>
      <div className={cn("amount-control", !sizing && "amount-off")}>
        <span className="control-label">Bet or raise to</span>
        <div className="stepper">
          <Button
            aria-label="Decrease amount"
            data-testid="amount-minus"
            size="icon"
            variant="ghost"
            disabled={!sizing || amount <= bounds.minimum}
            onClick={() => onAmount(adjustAmount(amount, -1, bounds))}
          ><Minus size={16} strokeWidth={1.5} /></Button>
          <strong data-testid="bet-amount">{amount}</strong>
          <Button
            aria-label="Increase amount"
            data-testid="amount-plus"
            size="icon"
            variant="ghost"
            disabled={!sizing || amount >= bounds.maximum}
            onClick={() => onAmount(adjustAmount(amount, 1, bounds))}
          ><Plus size={16} strokeWidth={1.5} /></Button>
        </div>
        <span className="step-note">{sizing ? `${fmt(bounds.minimum)} to ${fmt(bounds.maximum)}, step ${BIG_BLIND}` : "No raise available"}</span>
      </div>
      {actionError ? <p className="action-error" role="alert">{actionError}</p> : null}
    </div>
  );
}

function ResultSummary({ hand }: { hand: StoredHand }) {
  const categories = new Map(hand.result.hands.map((item) => [item.seat, item.category]));
  return (
    <div className="settlement">
      <ol className="pot-lines">
        {hand.result.pots.map((pot) => (
          <li key={pot.name}>
            <span className="pot-name">{pot.name}</span>
            <span className="pot-amount">{fmt(pot.amount)}</span>
            <span className="pot-winner">
              {pot.winnerSeats.map((seat) => `Player ${seat + 1}`).join(" and ")}
              {categories.get(pot.winnerSeats[0]) ? <em>{categories.get(pot.winnerSeats[0])}</em> : null}
            </span>
            <span className="pot-eligible">{pot.eligibleSeats.length} in contention</span>
          </li>
        ))}
      </ol>
      {hand.result.hands.length ? (
        <ul className="hand-lines">
          {hand.result.hands.map((item) => (
            <li key={item.seat} className={cn(hand.result.winnerSeats.includes(item.seat) && "hand-won")}>
              <span className="seat-tag">P{item.seat + 1}</span>
              <span className="best-five">{item.cards.map((card) => <PlayingCard key={card} card={card} size="mini" />)}</span>
              <span className="hand-category">{item.category}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function HistoryCard({ hand, onReplay }: { hand: StoredHand; onReplay: () => void }) {
  const winners = hand.result.winnerSeats;
  const top = winners.length ? Math.max(...winners.map((seat) => hand.winnings[String(seat)] ?? 0)) : 0;
  const time = new Date(hand.createdAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return (
    <article className="history-card" data-testid="history-entry">
      <div className="history-id">
        <span title={hand.id}>{hand.id}</span>
        <time dateTime={hand.createdAt}>{time}</time>
      </div>
      <div className="history-result">
        <strong>{winners.map((seat) => `Player ${seat + 1}`).join(", ")}</strong>
        <span className="net net-up">{signed(top)}</span>
        <span className="history-reason">{hand.result.reason === "fold" ? "No showdown" : "Showdown"}</span>
      </div>
      {hand.board.length ? (
        <div className="history-board">{hand.board.map((card) => <PlayingCard key={card} card={card} size="mini" />)}</div>
      ) : null}
      <p className="history-sequence">{hand.shortActionSequence || "fold win"}</p>
      <div className="history-nets">
        {hand.players.map((player) => {
          const value = hand.winnings[String(player.seat)] ?? 0;
          return (
            <span key={player.seat} className={cn(value > 0 && "net-up", value < 0 && "net-down")}>
              P{player.seat + 1} {signed(value)}
            </span>
          );
        })}
      </div>
      <p className="history-meta">
        Stack {fmt(hand.startingStack)}, dealer P{hand.dealerSeat + 1}, SB P{hand.smallBlindSeat + 1}, BB P{hand.bigBlindSeat + 1}
      </p>
      <p className="history-cards">{hand.players.map((player) => `P${player.seat + 1} ${player.holeCards.join(" ")}`).join(" / ")}</p>
      <Button size="sm" variant="outline" className="replay-button" onClick={onReplay}>Replay</Button>
    </article>
  );
}

function ReplayOverlay({
  replay,
  onChange,
  onClose,
}: {
  replay: { hand: StoredHand; step: number };
  onChange: (replay: { hand: StoredHand; step: number }) => void;
  onClose: () => void;
}) {
  const total = replay.hand.actions.length;
  const visible = replay.hand.actions.slice(0, replay.step);
  const current = replay.hand.actions[replay.step - 1];
  const dealtCards = visible.flatMap((action) => action.cards ?? []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowRight" && replay.step < total) onChange({ ...replay, step: replay.step + 1 });
      if (event.key === "ArrowLeft" && replay.step > 0) onChange({ ...replay, step: replay.step - 1 });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [replay, total, onChange, onClose]);

  return (
    <div className="replay-backdrop" role="dialog" aria-modal="true" aria-label="Hand replay">
      <section className="replay-card">
        <div className="replay-heading">
          <div><span className="control-label">Replay</span><h2>{replay.hand.id}</h2></div>
          <Button size="icon" variant="ghost" aria-label="Close replay" onClick={onClose}><X size={16} strokeWidth={1.5} /></Button>
        </div>
        <div className="replay-progress"><span style={{ transform: `scaleX(${total ? replay.step / total : 0})` }} /></div>
        <div className="replay-board">
          <div className="board">
            {Array.from({ length: 5 }, (_, index) => {
              const card = replay.hand.board[index];
              return <PlayingCard key={index} card={card && dealtCards.includes(card) ? card : undefined} size="board" />;
            })}
          </div>
          <strong>{current?.label ?? "Blinds, actions and streets in the order they happened"}</strong>
          <span>Step {replay.step} of {total}</span>
        </div>
        <div className="replay-log"><PlayLog actions={visible} /></div>
        {replay.step === total ? <ResultSummary hand={replay.hand} /> : null}
        <div className="replay-controls">
          <Button variant="outline" disabled={replay.step === 0} onClick={() => onChange({ ...replay, step: replay.step - 1 })}><ChevronLeft size={16} strokeWidth={1.5} /> Previous</Button>
          <span className="keys"><kbd>&larr;</kbd><kbd>&rarr;</kbd><kbd>Esc</kbd></span>
          <Button disabled={replay.step === total} onClick={() => onChange({ ...replay, step: replay.step + 1 })}>Next <ChevronRight size={16} strokeWidth={1.5} /></Button>
        </div>
      </section>
    </div>
  );
}
