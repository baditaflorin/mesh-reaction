import { useEffect, useMemo, useRef, useState } from "react";
import {
  type MeshConfig,
  type YRoom,
  ConfettiLayer,
  Leaderboard,
  createClockSync,
  useConfetti,
  useNamedPeer,
  usePerPeerValue,
  useRoster,
  useVibration,
} from "@baditaflorin/mesh-common";
import {
  FALSE_START,
  NOT_TAPPED,
  bestOf,
  formatMs,
  pickDelay,
  rankTimes,
  roundWinner,
  type RxEntry,
} from "./logic";

type Props = { room: YRoom | null; config: MeshConfig };

/** Shared round descriptor stored under `rx:round`. */
type Round = {
  /** Fresh id each arm — also the per-peer reaction-time map key suffix. */
  roundId: string;
  /** Mesh-clock ms at which the screen flips green. 0 = no round yet. */
  goAt: number;
  /** peerId of whoever armed the round. */
  armedBy: string;
};

const ROUND_KEY = "rx:round";
const BEST_KEY = "rx:best";
const TICK_MS = 50;

const EMPTY_ROUND: Round = { roundId: "", goAt: 0, armedBy: "" };

/** Shared round pointer with observe + arm. */
function useRound(room: YRoom | null) {
  const [, rerender] = useState(0);
  useEffect(() => {
    if (!room) return;
    const m = room.doc.getMap<Round>(ROUND_KEY);
    const cb = () => rerender((n) => n + 1);
    m.observe(cb);
    return () => m.unobserve(cb);
  }, [room]);

  const m = room ? room.doc.getMap<Round>(ROUND_KEY) : null;
  const round = (m?.get("current") as Round | undefined) ?? EMPTY_ROUND;

  const arm = (goAt: number) => {
    if (!m || !room) return;
    const roundId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    m.set("current", { roundId, goAt, armedBy: room.peerId });
  };

  return { round, arm };
}

export function Feature({ room, config }: Props) {
  const { names, myName, name, setName } = useNamedPeer(config, room);
  const roster = useRoster(room);
  const { burst } = useConfetti();
  const vibration = useVibration();

  // Mesh-median clock — every phone agrees on when `goAt` arrives.
  const clock = useMemo(() => (room ? createClockSync(room.provider) : null), [room]);
  useEffect(() => () => clock?.destroy(), [clock]);

  const { round, arm } = useRound(room);
  const hasRound = round.roundId !== "" && round.goAt > 0;

  // Per-peer reaction times for THIS round (key changes => clean slate).
  const times = usePerPeerValue<number>(room, `rx:t:${round.roundId || "none"}`, NOT_TAPPED);
  // Per-peer best-ever time, persisted across rounds under a stable key.
  const bests = usePerPeerValue<number>(room, BEST_KEY, NOT_TAPPED);

  // ~50ms re-render so we can detect the red→green flip without a network event.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!hasRound) return;
    const id = setInterval(() => setTick((n) => n + 1), TICK_MS);
    return () => clearInterval(id);
  }, [hasRound, round.roundId]);

  const meshNow = clock ? clock.meshNow() : Date.now();
  const isGo = hasRound && meshNow >= round.goAt;

  const myTime = times.my;
  const iTapped = myTime >= 0;
  const iFalseStarted = myTime === FALSE_START;
  const locked = iTapped || iFalseStarted; // already resolved this round

  // Vibrate exactly once when this phone flips to green.
  const flippedRef = useRef<string>("");
  useEffect(() => {
    if (!isGo) return;
    if (flippedRef.current === round.roundId) return;
    flippedRef.current = round.roundId;
    if (vibration.supported) vibration.vibrate([40, 30, 40]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGo, round.roundId]);

  // ---- Connecting state (room is null) — MUST render an <h1>. ----
  if (!room || !clock) {
    return (
      <div className="rx-wrap">
        <h1 className="rx-title">{config.appName}</h1>
        <p className="rx-status">Connecting to the room…</p>
      </div>
    );
  }

  const present = roster.present.length ? roster.present : [room.peerId];
  const nameFor = (id: string) =>
    names[id] || (id === room.peerId ? myName : `peer-${id.slice(0, 4)}`);

  // Build this round's entries from the per-peer time map.
  const entries: RxEntry[] = present.map((id) => ({
    id,
    name: nameFor(id),
    t: times.valueOf(id) ?? NOT_TAPPED,
    isMe: id === room.peerId,
  }));
  const ranked = rankTimes(entries);
  const winner = roundWinner(entries);

  const armRound = () => {
    // goAt is an ABSOLUTE mesh-clock timestamp — every peer compares its own
    // meshNow() against the same value, so the flip lands together.
    const seed = (Math.random() * 0xffffffff) >>> 0;
    arm(clock.meshNow() + pickDelay(seed));
  };

  const tap = () => {
    if (!hasRound || locked) return;
    if (clock.meshNow() < round.goAt) {
      // Jumped the gun → false start, locked out of scoring this round.
      times.setMy(FALSE_START);
      return;
    }
    const reaction = Math.max(0, Math.round(clock.meshNow() - round.goAt));
    times.setMy(reaction);
    // Fold into best-ever.
    const next = bestOf(bests.my, reaction);
    if (next !== bests.my) bests.setMy(next);
    // Crown: confetti if we are (currently) the fastest.
    const after = entries.map((e) => (e.id === room.peerId ? { ...e, t: reaction } : e));
    const w = roundWinner(after);
    if (w && w.id === room.peerId) {
      burst({ origin: "top", count: 90, hueRange: [110, 150] });
    }
  };

  const winnerName = winner ? nameFor(winner.id) : null;
  const armerName = round.armedBy ? nameFor(round.armedBy) : null;
  const headerCount = `${present.length} phone${present.length === 1 ? "" : "s"} here`;

  // ---- No round yet: idle lobby. ----
  if (!hasRound) {
    return (
      <div className="rx-wrap">
        <ConfettiLayer />
        <h1 className="rx-title">⚡ mesh-reaction</h1>
        <p className="rx-tagline">
          A group reflex contest. Everyone watches the same screen — when it flips green, the first
          to tap wins. Tap too early and it&apos;s a false start.
        </p>

        {!name.trim() && (
          <label className="rx-name">
            Your name
            <input
              type="text"
              value={name}
              maxLength={24}
              placeholder="e.g. Alex"
              onChange={(e) => setName(e.target.value)}
            />
          </label>
        )}

        <p className="rx-roster">
          <strong>{present.length}</strong> {present.length === 1 ? "phone" : "phones"} here:{" "}
          {present.map(nameFor).join(", ")}
        </p>

        {bests.my >= 0 && <p className="rx-best">your best: {formatMs(bests.my)}</p>}

        <button type="button" className="rx-arm" onClick={armRound}>
          Arm round
        </button>
        <p className="rx-hint">Anyone can arm. Hold steady — it flips after a random 2–6s.</p>
      </div>
    );
  }

  // ---- Armed but pre-flip: big red WAIT panel (tapping = false start). ----
  // ---- At/after goAt: big green TAP panel. ----
  const panelClass = isGo ? "rx-panel rx-go" : "rx-panel rx-wait";
  const secsToGo = Math.max(0, Math.ceil((round.goAt - meshNow) / 100) / 10);

  return (
    <div className="rx-wrap rx-playing" data-go={isGo ? "1" : "0"}>
      <ConfettiLayer />
      <h1 className="rx-title rx-title-sm">⚡ mesh-reaction</h1>

      <button
        type="button"
        className={panelClass}
        onClick={tap}
        disabled={locked}
        aria-label={isGo ? "Tap now" : "Wait for green"}
      >
        {iFalseStarted ? (
          <>
            <span className="rx-panel-big">FALSE START</span>
            <span className="rx-panel-sub">you jumped the gun — sit this round out</span>
          </>
        ) : isGo ? (
          <>
            <span className="rx-panel-big">TAP!</span>
            <span className="rx-panel-sub">
              {iTapped ? `you: ${formatMs(myTime)}` : "go go go"}
            </span>
          </>
        ) : (
          <>
            <span className="rx-panel-big">Wait for green…</span>
            <span className="rx-panel-sub">don&apos;t tap yet · ~{secsToGo.toFixed(1)}s</span>
          </>
        )}
      </button>

      <div className="rx-board">
        <Leaderboard
          items={ranked.map((e) => ({
            id: e.id,
            name: e.name,
            score: e.t,
            sub: e.t === FALSE_START ? "false start" : undefined,
            isMe: e.isMe,
          }))}
          highlightId={room.peerId}
          title={null}
          formatScore={formatMs}
          emptyText="waiting for the first tap…"
        />
        {winnerName && <p className="rx-winner">🏆 {winnerName} — fastest reflex</p>}
      </div>

      <div className="rx-foot">
        <span className="rx-foot-meta">
          {headerCount}
          {armerName ? ` · armed by ${armerName}` : ""}
          {bests.my >= 0 ? ` · your best ${formatMs(bests.my)}` : ""}
        </span>
        <button type="button" className="rx-arm rx-arm-ghost" onClick={armRound}>
          {isGo || locked ? "New round" : "Re-arm"}
        </button>
      </div>
    </div>
  );
}
