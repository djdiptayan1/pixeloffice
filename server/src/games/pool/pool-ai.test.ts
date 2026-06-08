// ---------------------------------------------------------------------------
// AI tests: returns a legal in-bounds shot; harder difficulty = tighter aim.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { POOL_TABLE_W, POOL_TABLE_H, type PoolBall, type PoolState } from "@pixeloffice/shared";
import { pickShot } from "./pool-ai";
import { freshPoolState, kindForId } from "./pool-setup";
import { applyShot } from "./pool-physics";
import { makePrng } from "./prng";

const AI = "AI";
const HUMAN = "human";

function ball(id: number, x: number, y: number): PoolBall {
  return { id, kind: kindForId(id), x, y, vx: 0, vy: 0, pocketed: false };
}

describe("pickShot: legality + bounds", () => {
  it("returns a finite, in-range shot on the opening rack", () => {
    const state = freshPoolState(AI);
    const shot = pickShot(state, AI, "medium", makePrng(1));
    expect(Number.isFinite(shot.angleRad)).toBe(true);
    expect(shot.power).toBeGreaterThanOrEqual(0);
    expect(shot.power).toBeLessThanOrEqual(1);
  });

  it("is deterministic for a given seed", () => {
    const state = freshPoolState(AI);
    const a = pickShot(state, AI, "hard", makePrng(42));
    const b = pickShot(state, AI, "hard", makePrng(42));
    expect(a).toEqual(b);
  });

  it("a shot from the AI keeps every ball inside the rails", () => {
    const state = freshPoolState(AI);
    const shot = pickShot(state, AI, "medium", makePrng(7));
    const res = applyShot(state.balls, shot.angleRad, shot.power);
    for (const b of res.balls) {
      if (b.pocketed) continue;
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x).toBeLessThanOrEqual(POOL_TABLE_W);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.y).toBeLessThanOrEqual(POOL_TABLE_H);
    }
  });

  it("targets its OWN group once assigned (aims roughly toward a solid)", () => {
    // Cue at left; one solid straight ahead, stripes off to the side.
    const balls: PoolBall[] = [
      ball(0, 40, 50),
      ball(2, 120, 50), // own solid dead ahead
      ball(11, 120, 90), // opponent stripe far below
    ];
    const state: PoolState = {
      balls,
      currentTurn: AI,
      assignedGroups: { [AI]: "solid", [HUMAN]: "stripe" },
      ballInHand: false,
      lastEvent: null,
      animating: false,
    };
    const shot = pickShot(state, AI, "hard", makePrng(3));
    // The aim should be roughly horizontal (toward the solid at the same y), not
    // steeply downward toward the stripe.
    expect(Math.abs(Math.sin(shot.angleRad))).toBeLessThan(0.5);
  });

  it("falls back to a soft shot when there are no legal targets", () => {
    const state: PoolState = {
      balls: [ball(0, 50, 50)],
      currentTurn: AI,
      assignedGroups: { [AI]: "solid", [HUMAN]: "stripe" },
      ballInHand: false,
      lastEvent: null,
      animating: false,
    };
    const shot = pickShot(state, AI, "easy", makePrng(9));
    expect(Number.isFinite(shot.angleRad)).toBe(true);
    expect(shot.power).toBeGreaterThan(0);
  });
});

describe("difficulty: harder = less aim noise", () => {
  it("hard deviates from the ideal aim less than easy, on average", () => {
    // A perfectly straight shot: cue and an own-group ball aligned with the
    // (W,50)... use a target that lines up toward a pocket so the ideal angle is
    // well-defined. Measure spread of chosen angles across many seeds.
    const balls: PoolBall[] = [ball(0, 40, 50), ball(2, 100, 50)];
    const base: PoolState = {
      balls,
      currentTurn: AI,
      assignedGroups: { [AI]: "solid", [HUMAN]: "stripe" },
      ballInHand: false,
      lastEvent: null,
      animating: false,
    };

    // The ideal (noise-free) angle is the angle the AI would pick with a PRNG
    // that returns 0.5 (zero centered noise).
    const ideal = pickShot(base, AI, "hard", () => 0.5).angleRad;

    const spread = (difficulty: "easy" | "hard"): number => {
      let sum = 0;
      const N = 40;
      for (let i = 0; i < N; i++) {
        const s = pickShot(base, AI, difficulty, makePrng(1000 + i));
        sum += Math.abs(s.angleRad - ideal);
      }
      return sum / N;
    };

    const easySpread = spread("easy");
    const hardSpread = spread("hard");
    expect(hardSpread).toBeLessThan(easySpread);
  });
});
