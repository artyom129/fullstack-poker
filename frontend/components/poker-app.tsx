"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  History,
  Minus,
  Plus,
  RotateCcw,
  Wifi,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getHands, saveHand } from "@/lib/api";
import {
  adjustAmount,
  amountBounds,
  applyAction,
  BIG_BLIND,
  type HandState,
  type PlayerAction,
  startHand,
  validActions,
} from "@/lib/poker/engine";
import { cn } from "@/lib/utils";
import type { StoredHand } from "@/types/api";

type SaveStatus = "idle" | "saving" | "saved" | "error";

export function PokerApp() {
  const [startingStack, setStartingStack] = useState("1000");
  const [hand, setHand] = useState<HandState | null>(null);
  const [amount, setAmount] = useState(BIG_BLIND);
  const [history, setHistory] = useState<StoredHand[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
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
  }

  function act(action: PlayerAction) {
    if (!hand) return;
    try {
      setHand(applyAction(hand, action, action === "bet" || action === "raise" ? amount : undefined));
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Invalid action");
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
        <div className="brand-mark">R</div>
        <div>
          <p className="eyebrow">Hold&apos;em hand lab</p>
          <h1>Riverline</h1>
        </div>
        <div className="topbar-status">
          <span className="status-dot" />
          <span>6-max / NL40</span>
          <span className="topbar-divider" />
          <Wifi size={14} />
          <span>Local table</span>
        </div>
      </header>

      <section className="workspace">
        <aside className="side-panel log-panel">
          <PanelHeading icon={<Activity size={16} />} title="Play log" meta={hand ? `${hand.actions.length} events` : "Waiting"} />
          <div className="scroll-area" data-testid="play-log">
            {hand ? (
              <ol className="event-list">
                {hand.actions.map((action, index) => (
                  <li key={`${index}-${action.label}`} className={cn("event", action.cards && "street-event")}>
                    <span className="event-index">{String(index + 1).padStart(2, "0")}</span>
                    <span>{action.label}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <EmptyState title="No hand in progress" detail="Set the table stack and start a hand." />
            )}
          </div>
        </aside>

        <section className="table-column">
          <div className="control-strip">
            <div>
              <span className="control-label">Starting stack</span>
              <div className="stack-input-wrap">
                <CircleDollarSign size={15} />
                <Input
                  aria-label="Starting stack"
                  data-testid="starting-stack"
                  inputMode="numeric"
                  min={80}
                  step={40}
                  value={startingStack}
                  onChange={(event) => setStartingStack(event.target.value)}
                />
              </div>
            </div>
            <Button
              data-testid="start-reset"
              variant={resetReady ? "outline" : "default"}
              disabled={startDisabled || (hand !== null && !resetReady)}
              onClick={beginHand}
            >
              {resetReady ? <RotateCcw size={15} /> : null}
              {resetReady ? "Reset" : "Start"}
            </Button>
          </div>

          <div className="table-stage">
            <div className="felt-outline">
              <div className="felt-inner">
                {hand ? (
                  <>
                    <div className="table-readout">
                      <Badge className="street-badge">{hand.street}</Badge>
                      <span>Pot</span>
                      <strong>{hand.pot}</strong>
                      <div className="board" aria-label="Community cards">
                        {Array.from({ length: 5 }, (_, index) => (
                          <PlayingCard key={index} card={hand.board[index]} muted />
                        ))}
                      </div>
                    </div>
                    {hand.players.map((player) => (
                      <PlayerSeat
                        key={player.seat}
                        player={player}
                        active={hand.currentPlayerSeat === player.seat}
                        dealer={hand.dealerSeat === player.seat}
                        smallBlind={hand.smallBlindSeat === player.seat}
                        bigBlind={hand.bigBlindSeat === player.seat}
                      />
                    ))}
                  </>
                ) : (
                  <div className="table-empty">
                    <div className="table-empty-icon">R</div>
                    <strong>Table ready</strong>
                    <span>Six seats / blinds 20 / 40</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          <ActionConsole
            hand={hand}
            amount={amount}
            bounds={bounds}
            available={available}
            saveStatus={saveStatus}
            saveError={saveError}
            settledHand={settledHand}
            onAmount={setAmount}
            onAction={act}
            onRetrySave={retrySave}
          />
        </section>

        <aside className="side-panel history-panel">
          <PanelHeading icon={<History size={16} />} title="Hand history" meta={`${history.length} saved`} />
          <div className="scroll-area history-scroll" data-testid="hand-history">
            {historyLoading ? (
              <EmptyState title="Loading history" detail="Reading saved hands from PostgreSQL..." />
            ) : historyError ? (
              <div className="error-state">
                <p>{historyError}</p>
                <Button size="sm" variant="outline" onClick={() => void loadHistory()}>Retry</Button>
              </div>
            ) : history.length === 0 ? (
              <EmptyState title="No saved hands" detail="Completed hands will appear here automatically." />
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
      <div className="empty-glyph">--</div>
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  );
}

function PlayerSeat({
  player,
  active,
  dealer,
  smallBlind,
  bigBlind,
}: {
  player: HandState["players"][number];
  active: boolean;
  dealer: boolean;
  smallBlind: boolean;
  bigBlind: boolean;
}) {
  return (
    <div
      className={cn("player-seat", `seat-${player.seat}`, active && "active-seat", player.folded && "folded-seat")}
      data-testid={`player-${player.seat}`}
    >
      <div className="seat-topline">
        <span>{player.name}</span>
        <div className="seat-badges">
          {dealer ? <i>D</i> : null}
          {smallBlind ? <i>SB</i> : null}
          {bigBlind ? <i>BB</i> : null}
        </div>
      </div>
      <div className="hole-cards">
        {player.holeCards.map((card) => <PlayingCard key={card} card={card} />)}
      </div>
      <div className="seat-numbers">
        <span>Stack <strong>{player.stack}</strong></span>
        <span>In pot <strong>{player.committedTotal}</strong></span>
      </div>
      {player.allIn ? <Badge className="state-badge">All-in</Badge> : null}
      {player.folded ? <Badge className="state-badge">Folded</Badge> : null}
    </div>
  );
}

function PlayingCard({ card, muted = false }: { card?: string; muted?: boolean }) {
  if (!card) return <span className="playing-card card-slot" />;
  const suit = card[1];
  const symbol = suit === "h" ? "\u2665" : suit === "d" ? "\u2666" : suit === "c" ? "\u2663" : "\u2660";
  return (
    <span className={cn("playing-card", (suit === "h" || suit === "d") && "red-card", muted && "board-card")}>
      <b>{card[0]}</b><i>{symbol}</i>
    </span>
  );
}

function ActionConsole({
  hand,
  amount,
  bounds,
  available,
  saveStatus,
  saveError,
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
  settledHand: StoredHand | null;
  onAmount: (amount: number) => void;
  onAction: (action: PlayerAction) => void;
  onRetrySave: () => void;
}) {
  if (!hand) {
    return <div className="action-console console-empty">Start a hand to enable player controls.</div>;
  }
  if (hand.completed) {
    return (
      <div className="action-console completed-console" data-testid="hand-completed">
        <div>
          <span className="control-label">Hand complete</span>
          <strong>{hand.finishReason === "fold" ? "Won without showdown" : "Showdown settled"}</strong>
        </div>
        <div className={cn("save-pill", `save-${saveStatus}`)}>
          {saveStatus === "saving" ? "Validating & saving..." : saveStatus === "saved" ? "Saved to history" : saveStatus === "error" ? saveError : "Preparing result"}
        </div>
        {saveStatus === "error" ? <Button size="sm" variant="outline" onClick={onRetrySave}>Retry save</Button> : null}
        {settledHand ? <ResultSummary hand={settledHand} /> : null}
      </div>
    );
  }

  const player = hand.players[hand.currentPlayerSeat ?? 0];
  return (
    <div className="action-console">
      <div className="actor-line">
        <span className="turn-pulse" />
        <div><span className="control-label">Action on</span><strong>{player.name}</strong></div>
        <div className="to-call"><span>To call</span><strong>{Math.max(0, hand.currentBet - player.committedThisStreet)}</strong></div>
      </div>
      <div className="action-buttons">
        {(["fold", "check", "call", "bet", "raise", "allin"] as PlayerAction[]).map((action) => (
          <Button
            key={action}
            data-testid={`action-${action}`}
            variant={action === "fold" ? "destructive" : action === "allin" ? "secondary" : "outline"}
            disabled={!available.has(action)}
            onClick={() => onAction(action)}
          >
            {action === "allin" ? "All-in" : `${action[0].toUpperCase()}${action.slice(1)}`}
          </Button>
        ))}
      </div>
      <div className="amount-control">
        <span className="control-label">Bet / raise to</span>
        <Button
          aria-label="Decrease amount"
          data-testid="amount-minus"
          size="icon"
          variant="ghost"
          disabled={amount <= bounds.minimum}
          onClick={() => onAmount(adjustAmount(amount, -1, bounds))}
        ><Minus size={15} /></Button>
        <strong data-testid="bet-amount">{amount}</strong>
        <Button
          aria-label="Increase amount"
          data-testid="amount-plus"
          size="icon"
          variant="ghost"
          disabled={amount >= bounds.maximum}
          onClick={() => onAmount(adjustAmount(amount, 1, bounds))}
        ><Plus size={15} /></Button>
        <span className="step-note">+/- {BIG_BLIND}</span>
      </div>
    </div>
  );
}

function ResultSummary({ hand }: { hand: StoredHand }) {
  const winners = hand.result.winnerSeats.map((seat) => `Player ${seat + 1}`).join(", ");
  return (
    <div className="result-summary">
      <div><span>Winner{hand.result.winnerSeats.length > 1 ? "s" : ""}</span><strong>{winners}</strong></div>
      {hand.result.hands.map((result) => (
        <div key={result.seat}><span>Player {result.seat + 1}</span><strong>{result.category}</strong></div>
      ))}
      <div className="pot-breakdown">
        {hand.result.pots.map((pot) => <span key={pot.name}>{pot.name} {pot.amount} -&gt; {pot.winnerSeats.map((seat) => `P${seat + 1}`).join(" / ")}</span>)}
      </div>
    </div>
  );
}

function HistoryCard({ hand, onReplay }: { hand: StoredHand; onReplay: () => void }) {
  const cards = hand.players.map((player) => `P${player.seat + 1} ${player.holeCards.join(" ")}`).join(" / ");
  const winnings = hand.players
    .map((player) => {
      const value = hand.winnings[String(player.seat)] ?? 0;
      return `P${player.seat + 1} ${value >= 0 ? "+" : ""}${value}`;
    })
    .join(" / ");
  return (
    <article className="history-card" data-testid="history-entry">
      <div className="history-id"><span>{hand.id}</span><Button size="sm" variant="ghost" onClick={onReplay}>Replay</Button></div>
      <p>Stack {hand.startingStack} / D P{hand.dealerSeat + 1} / SB P{hand.smallBlindSeat + 1} / BB P{hand.bigBlindSeat + 1}</p>
      <p className="history-cards">{cards}</p>
      <p className="history-sequence">{hand.shortActionSequence || "fold win"}</p>
      <p className="history-winnings">{winnings}</p>
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
  const visible = replay.hand.actions.slice(0, replay.step);
  const current = replay.hand.actions[replay.step - 1];
  return (
    <div className="replay-backdrop" role="dialog" aria-modal="true" aria-label="Hand replay">
      <section className="replay-card">
        <div className="replay-heading">
          <div><span className="eyebrow">Read-only hand replay</span><h2>{replay.hand.id}</h2></div>
          <Button size="icon" variant="ghost" aria-label="Close replay" onClick={onClose}><X size={18} /></Button>
        </div>
        <div className="replay-progress"><span style={{ width: `${(replay.step / replay.hand.actions.length) * 100}%` }} /></div>
        <div className="replay-board">
          <div className="board">
            {replay.hand.board.map((card) => {
              const dealtCards = visible.flatMap((action) => action.cards ?? []);
              return <PlayingCard key={card} card={dealtCards.includes(card) ? card : undefined} muted />;
            })}
          </div>
          <strong>{current?.label ?? "Ready to replay blinds and actions"}</strong>
          <span>Step {replay.step} of {replay.hand.actions.length}</span>
        </div>
        <ol className="replay-events">
          {visible.map((action, index) => <li key={`${index}-${action.label}`}>{action.label}</li>)}
        </ol>
        {replay.step === replay.hand.actions.length ? <ResultSummary hand={replay.hand} /> : null}
        <div className="replay-controls">
          <Button variant="outline" disabled={replay.step === 0} onClick={() => onChange({ ...replay, step: replay.step - 1 })}><ChevronLeft size={16} /> Previous</Button>
          <Button disabled={replay.step === replay.hand.actions.length} onClick={() => onChange({ ...replay, step: replay.step + 1 })}>Next <ChevronRight size={16} /></Button>
        </div>
      </section>
    </div>
  );
}

