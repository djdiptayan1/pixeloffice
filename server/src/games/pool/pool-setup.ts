// ---------------------------------------------------------------------------
// Initial 8-ball rack + fresh game state. Pure + deterministic (no clock/random).
// ---------------------------------------------------------------------------

import {
  POOL_TABLE_W,
  POOL_TABLE_H,
  POOL_BALL_R,
  type PoolBall,
  type PoolBallKind,
  type PoolState,
} from "@pixeloffice/shared";

/** Classify a ball id into its kind (0 cue, 8 eight, 1-7 solid, 9-15 stripe). */
export function kindForId(id: number): PoolBallKind {
  if (id === 0) return "cue";
  if (id === 8) return "eight";
  return id <= 7 ? "solid" : "stripe";
}

/**
 * Build the standard triangle rack at the foot spot plus the cue ball on the
 * head spot. The triangle has the 8-ball in the center (3rd row middle) and
 * solids/stripes interleaved deterministically (no randomness).
 *
 * Layout in table units: the long axis is x. The head spot (cue) sits at 1/4 W,
 * the rack apex at 3/4 W, opening toward +x.
 */
export function rackBalls(): PoolBall[] {
  const balls: PoolBall[] = [];
  const cy = POOL_TABLE_H / 2;

  // Cue ball on the head spot.
  balls.push({ id: 0, kind: "cue", x: POOL_TABLE_W * 0.25, y: cy, vx: 0, vy: 0, pocketed: false });

  // Triangle of 15 balls; rows grow toward +x. Spacing = just over a diameter so
  // they start touching-but-resolved.
  const gap = POOL_BALL_R * 2.02;
  const apexX = POOL_TABLE_W * 0.7;

  // Deterministic ball order per row (8 fixed at center of row 3). Solids first
  // then stripes for the remaining slots — a legal, balanced rack.
  const order = [1, 9, 2, 8, 10, 3, 11, 4, 12, 13, 5, 14, 6, 15, 7];
  let idx = 0;
  for (let row = 0; row < 5; row++) {
    const count = row + 1;
    const rowX = apexX + row * (gap * Math.sin(Math.PI / 3));
    const startY = cy - (row * gap) / 2;
    for (let k = 0; k < count; k++) {
      const id = order[idx++];
      balls.push({
        id,
        kind: kindForId(id),
        x: rowX,
        y: startY + k * gap,
        vx: 0,
        vy: 0,
        pocketed: false,
      });
    }
  }
  return balls;
}

/** A fresh pool state with the rack set and `firstTurn` to break. */
export function freshPoolState(firstTurn: string): PoolState {
  return {
    balls: rackBalls(),
    currentTurn: firstTurn,
    assignedGroups: {},
    ballInHand: false,
    lastEvent: null,
    animating: false,
  };
}
