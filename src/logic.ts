// Pure, deterministic helpers — no React, no Yjs — so they can be unit-tested
// in isolation and produce identical results on every phone.

/** Per-peer reaction-time sentinels stored in the shared `Y.Map`. */
export const NOT_TAPPED = -1;
export const FALSE_START = -2;

/** Round timing bounds (ms) — the F1-start-light random hold window. */
export const MIN_DELAY_MS = 2000;
export const MAX_DELAY_MS = 6000;

/** Mulberry32: tiny, fast, deterministic PRNG seeded by a 32-bit integer. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Random hold delay in [MIN_DELAY_MS, MAX_DELAY_MS] from a 32-bit seed.
 * Deterministic in the seed so the value is testable; the armer picks a fresh
 * random seed each round, and the resulting `goAt` is shared (not the seed),
 * so every phone flips green at the same mesh-clock instant.
 */
export function pickDelay(seed: number): number {
  const span = MAX_DELAY_MS - MIN_DELAY_MS;
  return MIN_DELAY_MS + Math.floor(mulberry32(seed)() * (span + 1));
}

/** A tap value is a real reaction time iff it's a non-negative number. */
export function isTapped(t: number): boolean {
  return t >= 0;
}

/** True iff the peer jumped the gun this round. */
export function isFalseStart(t: number): boolean {
  return t === FALSE_START;
}

export type RxEntry = {
  /** Stable peer id. */
  id: string;
  /** Display name. */
  name: string;
  /** Reaction time in ms, or a sentinel (NOT_TAPPED / FALSE_START). */
  t: number;
  /** True for the local peer (drives highlight). */
  isMe?: boolean;
};

export type RxStatus = "tapped" | "false-start" | "waiting";

/** Classify a raw per-peer value into a presentable status. */
export function classify(t: number): RxStatus {
  if (t === FALSE_START) return "false-start";
  if (isTapped(t)) return "tapped";
  return "waiting";
}

/**
 * Rank a round's entries for the leaderboard:
 *   1. Everyone who tapped, fastest (lowest ms) first.
 *   2. Then false-starters (order stable by name).
 *   3. "Waiting" (not-yet-tapped, no false start) peers are dropped — they have
 *      no result to show this round.
 * Pure and total: returns a new array, never mutates the input.
 */
export function rankTimes(entries: RxEntry[]): RxEntry[] {
  const tapped = entries.filter((e) => isTapped(e.t)).sort((a, b) => a.t - b.t || cmpName(a, b));
  const falsed = entries.filter((e) => isFalseStart(e.t)).sort(cmpName);
  return [...tapped, ...falsed];
}

function cmpName(a: RxEntry, b: RxEntry): number {
  return a.name.localeCompare(b.name);
}

/** The winning entry (fastest tap) of a round, or null if nobody tapped. */
export function roundWinner(entries: RxEntry[]): RxEntry | null {
  const ranked = rankTimes(entries);
  const first = ranked[0];
  return first && isTapped(first.t) ? first : null;
}

/** Format a reaction time for display. Sentinels render as words. */
export function formatMs(ms: number): string {
  if (ms === FALSE_START) return "false start";
  if (ms === NOT_TAPPED) return "—";
  if (ms < 0) return "—";
  return `${Math.round(ms)} ms`;
}

/**
 * Fold a peer's previous best and a new reaction time into the new best.
 * Only real (non-sentinel) taps count; a false start never improves a best.
 */
export function bestOf(prevBest: number, candidate: number): number {
  if (!isTapped(candidate)) return prevBest;
  if (!isTapped(prevBest)) return candidate;
  return Math.min(prevBest, candidate);
}
