// ---------------------------------------------------------------------------
// 8-ball rules tests. The rules engine takes a pre-shot PoolState + a SimResult,
// so we build synthetic SimResults to exercise each rule deterministically.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import type { PoolBall, PoolGroup, PoolState } from "@pixeloffice/shared";
import { resolveShot } from "./pool-rules";
import { freshPoolState, kindForId } from "./pool-setup";
import type { SimResult } from "./pool-physics";

const A = "alice";
const B = "bob";

function ball(id: number, pocketed = false): PoolBall {
  return { id, kind: kindForId(id), x: 0, y: 0, vx: 0, vy: 0, pocketed };
}

/** A full set of 16 balls, with the given ids marked pocketed. */
function tableWith(pocketedIds: number[] = []): PoolBall[] {
  const set = new Set(pocketedIds);
  const balls: PoolBall[] = [];
  for (let id = 0; id <= 15; id++) balls.push(ball(id, set.has(id)));
  return balls;
}

function state(opts: Partial<PoolState> & { balls: PoolBall[] }): PoolState {
  return {
    balls: opts.balls,
    currentTurn: opts.currentTurn ?? A,
    assignedGroups: opts.assignedGroups ?? {},
    ballInHand: opts.ballInHand ?? false,
    lastEvent: null,
    animating: false,
  };
}

/** Build a SimResult given the resulting balls + foul-relevant metadata. */
function sim(
  balls: PoolBall[],
  o: {
    pocketed?: number[];
    cueScratched?: boolean;
    firstContactId?: number | null;
    anyCushionHit?: boolean;
  } = {},
): SimResult {
  return {
    balls,
    pocketed: o.pocketed ?? [],
    cueScratched: o.cueScratched ?? false,
    firstContactId: o.firstContactId ?? null,
    anyCushionHit: o.anyCushionHit ?? true,
    trajectory: [],
  };
}

describe("open-table group assignment", () => {
  it("legally potting a solid assigns solids to the shooter, stripes to opponent", () => {
    const prev = state({ balls: tableWith() });
    const after = tableWith([1]); // solid #1 sunk
    const res = resolveShot(prev, A, B, sim(after, { pocketed: [1], firstContactId: 1 }));
    expect(res.state.assignedGroups[A]).toBe("solid");
    expect(res.state.assignedGroups[B]).toBe("stripe");
    expect(res.state.currentTurn).toBe(A); // keep the table after a legal pot
    expect(res.event.foul).toBe(false);
  });

  it("legally potting a stripe assigns stripes to the shooter", () => {
    const prev = state({ balls: tableWith() });
    const after = tableWith([9]);
    const res = resolveShot(prev, A, B, sim(after, { pocketed: [9], firstContactId: 9 }));
    expect(res.state.assignedGroups[A]).toBe("stripe");
    expect(res.state.assignedGroups[B]).toBe("solid");
  });

  it("hitting the 8 first on an open table is a foul (no assignment)", () => {
    const prev = state({ balls: tableWith() });
    const res = resolveShot(prev, A, B, sim(tableWith(), { firstContactId: 8 }));
    expect(res.event.foul).toBe(true);
    expect(res.state.assignedGroups).toEqual({});
    expect(res.state.currentTurn).toBe(B);
    expect(res.state.ballInHand).toBe(true);
  });
});

describe("wrong-group foul", () => {
  it("hitting the opponent's group first is a foul -> ball-in-hand to opponent", () => {
    const assigned: Record<string, PoolGroup> = { [A]: "solid", [B]: "stripe" };
    const prev = state({ balls: tableWith(), assignedGroups: assigned, currentTurn: A });
    // A (solids) hits a stripe (id 10) first.
    const res = resolveShot(prev, A, B, sim(tableWith(), { firstContactId: 10 }));
    expect(res.event.foul).toBe(true);
    expect(res.state.currentTurn).toBe(B);
    expect(res.state.ballInHand).toBe(true);
  });

  it("hitting your own group first and potting it keeps the turn", () => {
    const assigned: Record<string, PoolGroup> = { [A]: "solid", [B]: "stripe" };
    const prev = state({ balls: tableWith(), assignedGroups: assigned, currentTurn: A });
    const res = resolveShot(prev, A, B, sim(tableWith([2]), { pocketed: [2], firstContactId: 2 }));
    expect(res.event.foul).toBe(false);
    expect(res.state.currentTurn).toBe(A); // potted own ball -> shoot again
  });

  it("hitting own group but potting nothing passes the turn (no foul)", () => {
    const assigned: Record<string, PoolGroup> = { [A]: "solid", [B]: "stripe" };
    const prev = state({ balls: tableWith(), assignedGroups: assigned, currentTurn: A });
    const res = resolveShot(prev, A, B, sim(tableWith(), { firstContactId: 3 }));
    expect(res.event.foul).toBe(false);
    expect(res.state.currentTurn).toBe(B);
    expect(res.state.ballInHand).toBe(false);
  });
});

describe("scratch foul -> ball-in-hand", () => {
  it("pocketing the cue is a foul and grants ball-in-hand", () => {
    const assigned: Record<string, PoolGroup> = { [A]: "solid", [B]: "stripe" };
    const prev = state({ balls: tableWith(), assignedGroups: assigned, currentTurn: A });
    const after = tableWith([0, 1]); // potted own ball but scratched
    const res = resolveShot(
      prev,
      A,
      B,
      sim(after, { pocketed: [1, 0], cueScratched: true, firstContactId: 1 }),
    );
    expect(res.event.foul).toBe(true);
    expect(res.event.scratch).toBe(true);
    expect(res.state.currentTurn).toBe(B);
    expect(res.state.ballInHand).toBe(true);
  });
});

describe("8-ball win / lose", () => {
  it("legally potting the 8 after clearing your group is a WIN", () => {
    // A is solids and has potted 1..7 already; only the 8 remains for A.
    const assigned: Record<string, PoolGroup> = { [A]: "solid", [B]: "stripe" };
    const prevBalls = tableWith([1, 2, 3, 4, 5, 6, 7]); // all solids gone
    const prev = state({ balls: prevBalls, assignedGroups: assigned, currentTurn: A });
    const after = tableWith([1, 2, 3, 4, 5, 6, 7, 8]);
    const res = resolveShot(prev, A, B, sim(after, { pocketed: [8], firstContactId: 8 }));
    expect(res.winnerSessionId).toBe(A);
    expect(res.state.currentTurn).toBe(A);
    expect(res.event.reason).toBe("win");
  });

  it("potting the 8 early (group not cleared) is a LOSS", () => {
    const assigned: Record<string, PoolGroup> = { [A]: "solid", [B]: "stripe" };
    const prev = state({ balls: tableWith([1, 2]), assignedGroups: assigned, currentTurn: A });
    const after = tableWith([1, 2, 8]);
    const res = resolveShot(prev, A, B, sim(after, { pocketed: [8], firstContactId: 3 }));
    expect(res.winnerSessionId).toBe(B);
    expect(res.event.reason).toBe("illegal-8-loss");
  });

  it("potting the 8 AND scratching is a LOSS even after clearing the group", () => {
    const assigned: Record<string, PoolGroup> = { [A]: "solid", [B]: "stripe" };
    const prev = state({
      balls: tableWith([1, 2, 3, 4, 5, 6, 7]),
      assignedGroups: assigned,
      currentTurn: A,
    });
    const after = tableWith([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    const res = resolveShot(
      prev,
      A,
      B,
      sim(after, { pocketed: [8, 0], cueScratched: true, firstContactId: 8 }),
    );
    expect(res.winnerSessionId).toBe(B);
  });
});

describe("turn pass vs keep + fresh state", () => {
  it("a clean miss passes the turn without ball-in-hand", () => {
    const assigned: Record<string, PoolGroup> = { [A]: "solid", [B]: "stripe" };
    const prev = state({ balls: tableWith(), assignedGroups: assigned, currentTurn: A });
    const res = resolveShot(prev, A, B, sim(tableWith(), { firstContactId: 1 }));
    expect(res.state.currentTurn).toBe(B);
    expect(res.state.ballInHand).toBe(false);
  });

  it("freshPoolState sets the breaker as the first turn and an open table", () => {
    const s = freshPoolState(A);
    expect(s.currentTurn).toBe(A);
    expect(s.assignedGroups).toEqual({});
    expect(s.ballInHand).toBe(false);
    expect(s.balls.filter((b) => !b.pocketed)).toHaveLength(16);
  });
});
