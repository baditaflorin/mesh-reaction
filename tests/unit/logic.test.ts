import { describe, expect, it } from "vitest";
import {
  FALSE_START,
  MAX_DELAY_MS,
  MIN_DELAY_MS,
  NOT_TAPPED,
  bestOf,
  classify,
  formatMs,
  isFalseStart,
  isTapped,
  pickDelay,
  rankTimes,
  roundWinner,
  type RxEntry,
} from "../../src/logic";

describe("pickDelay", () => {
  it("stays within the [MIN, MAX] hold window for many seeds", () => {
    for (let seed = 0; seed < 500; seed++) {
      const d = pickDelay(seed);
      expect(d).toBeGreaterThanOrEqual(MIN_DELAY_MS);
      expect(d).toBeLessThanOrEqual(MAX_DELAY_MS);
    }
  });

  it("is deterministic in the seed", () => {
    expect(pickDelay(42)).toBe(pickDelay(42));
  });

  it("varies across seeds", () => {
    const a = pickDelay(1);
    const b = pickDelay(2);
    const c = pickDelay(3);
    expect(new Set([a, b, c]).size).toBeGreaterThan(1);
  });
});

describe("classify / sentinels", () => {
  it("classifies tapped, false-start, and waiting", () => {
    expect(classify(123)).toBe("tapped");
    expect(classify(0)).toBe("tapped");
    expect(classify(FALSE_START)).toBe("false-start");
    expect(classify(NOT_TAPPED)).toBe("waiting");
  });

  it("isTapped / isFalseStart predicates", () => {
    expect(isTapped(0)).toBe(true);
    expect(isTapped(250)).toBe(true);
    expect(isTapped(NOT_TAPPED)).toBe(false);
    expect(isTapped(FALSE_START)).toBe(false);
    expect(isFalseStart(FALSE_START)).toBe(true);
    expect(isFalseStart(250)).toBe(false);
  });
});

describe("formatMs", () => {
  it("formats real times and sentinels", () => {
    expect(formatMs(250)).toBe("250 ms");
    expect(formatMs(249.6)).toBe("250 ms");
    expect(formatMs(FALSE_START)).toBe("false start");
    expect(formatMs(NOT_TAPPED)).toBe("—");
  });
});

describe("rankTimes", () => {
  const entries: RxEntry[] = [
    { id: "a", name: "Ada", t: 320 },
    { id: "b", name: "Bo", t: FALSE_START },
    { id: "c", name: "Cy", t: 180 },
    { id: "d", name: "Di", t: NOT_TAPPED },
    { id: "e", name: "Ed", t: 180 },
  ];

  it("orders tappers fastest-first with false starts at the bottom", () => {
    const out = rankTimes(entries).map((e) => e.id);
    // 180s first (tie broken by name: Cy < Ed), then 320 (Ada), then false start (Bo).
    expect(out).toEqual(["c", "e", "a", "b"]);
  });

  it("drops not-yet-tapped peers (no result this round)", () => {
    expect(rankTimes(entries).find((e) => e.id === "d")).toBeUndefined();
  });

  it("does not mutate its input", () => {
    const copy = entries.map((e) => ({ ...e }));
    rankTimes(entries);
    expect(entries).toEqual(copy);
  });

  it("returns [] when nobody has a result", () => {
    expect(rankTimes([{ id: "x", name: "X", t: NOT_TAPPED }])).toEqual([]);
  });
});

describe("roundWinner", () => {
  it("returns the fastest tapper", () => {
    const w = roundWinner([
      { id: "a", name: "A", t: 300 },
      { id: "b", name: "B", t: 120 },
    ]);
    expect(w?.id).toBe("b");
  });

  it("is null when only false starts / no taps exist", () => {
    expect(roundWinner([{ id: "a", name: "A", t: FALSE_START }])).toBeNull();
    expect(roundWinner([])).toBeNull();
  });
});

describe("bestOf", () => {
  it("keeps the smaller real time and ignores sentinels", () => {
    expect(bestOf(NOT_TAPPED, 300)).toBe(300);
    expect(bestOf(300, 250)).toBe(250);
    expect(bestOf(250, 300)).toBe(250);
    expect(bestOf(250, FALSE_START)).toBe(250);
    expect(bestOf(NOT_TAPPED, FALSE_START)).toBe(NOT_TAPPED);
  });
});
