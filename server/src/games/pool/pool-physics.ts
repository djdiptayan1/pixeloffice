// ---------------------------------------------------------------------------
// Deterministic 2D billiards simulator (framework-free, no clock, no Math.random).
//
// All positions/velocities are in TABLE UNITS (tu) on the fixed playfield
// [0, POOL_TABLE_W] x [0, POOL_TABLE_H] (origin top-left, +x right, +y down).
//
// The model is intentionally simple but physically sane and fully deterministic:
//   - elastic circle-circle collisions between equal-mass balls (1D impulse along
//     the contact normal — momentum + KE conserved along the line of centers),
//   - reflection off the four cushions (rails),
//   - rolling friction (per-second velocity decay applied each fixed step),
//   - pocket capture: a ball whose CENTER comes within POOL_POCKET_R of a pocket
//     center is removed from play (pocketed),
//   - settling detection: the shot is simulated until every ball's speed is below
//     a rest threshold (or a hard step cap, to bound worst cases).
//
// Anti-tunnelling: the integrator sub-steps so no ball moves more than a fraction
// of its radius per sub-step, and collisions are resolved with positional
// separation so two balls never pass through each other.
// ---------------------------------------------------------------------------

import {
  POOL_TABLE_W,
  POOL_TABLE_H,
  POOL_BALL_R,
  POOL_POCKET_R,
  POOL_POCKETS,
  type PoolBall,
} from "@pixeloffice/shared";

/** Velocity decay per SECOND from rolling friction (fraction retained). */
const FRICTION_PER_SEC = 0.55; // ~45% of speed shed per second
/** Below this speed (tu/sec) a ball is treated as stopped. */
const REST_SPEED = 0.35;
/** Cushion restitution (energy kept on a rail bounce). */
const CUSHION_RESTITUTION = 0.92;
/** Ball-ball restitution (1 = perfectly elastic). */
const BALL_RESTITUTION = 0.96;
/** Fixed outer timestep (seconds) for a settle step. */
export const POOL_DT = 1 / 60;
/** Hard cap on settle steps so a degenerate shot can never loop forever. */
const MAX_SETTLE_STEPS = 1800; // 30s of sim at 60Hz
/** Max speed a full-power shot imparts (tu/sec). */
export const POOL_MAX_SHOT_SPEED = 420;

const TWO_R = POOL_BALL_R * 2;
const TWO_R_SQ = TWO_R * TWO_R;

/** One animation frame: compact positions of every ball at a sim step. */
export type PoolFrame = Array<{ id: number; x: number; y: number; pocketed: boolean }>;

export interface SimResult {
  /** The balls at rest after the shot (same array identity NOT guaranteed — fresh objects). */
  balls: PoolBall[];
  /** Ordered list of ball ids potted during the shot. */
  pocketed: number[];
  /** True if the cue ball (id 0) was pocketed. */
  cueScratched: boolean;
  /** The first ball the cue contacted, or null (used for foul detection). */
  firstContactId: number | null;
  /** True if any ball touched any cushion (used for the "no-rail" foul rule). */
  anyCushionHit: boolean;
  /** Ordered animation frames (downsampled) for the client to replay. */
  trajectory: PoolFrame[];
}

/** Deep-copy a ball array (the simulator never mutates its input). */
export function cloneBalls(balls: PoolBall[]): PoolBall[] {
  return balls.map((b) => ({ ...b }));
}

function speedSq(b: PoolBall): number {
  return b.vx * b.vx + b.vy * b.vy;
}

function frameOf(balls: PoolBall[]): PoolFrame {
  return balls.map((b) => ({ id: b.id, x: b.x, y: b.y, pocketed: b.pocketed }));
}

/**
 * Advance the table to REST after applying a shot's initial cue velocity (the
 * caller sets cue.vx/vy before calling, or use applyShot()). Pure: operates on a
 * clone, returns the final balls + the event metadata + animation frames.
 *
 * @param input    the balls BEFORE the shot (cue velocity already set).
 * @param dt       fixed outer timestep (defaults to POOL_DT).
 */
export function simulateToRest(input: PoolBall[], dt: number = POOL_DT): SimResult {
  const balls = cloneBalls(input);
  const byId = new Map<number, PoolBall>(balls.map((b) => [b.id, b]));
  const cue = byId.get(0);

  const pocketed: number[] = [];
  let cueScratched = false;
  let firstContactId: number | null = null;
  let anyCushionHit = false;
  const trajectory: PoolFrame[] = [frameOf(balls)];

  // Sub-stepping: cap displacement per sub-step to a fraction of the radius so a
  // fast ball cannot tunnel through another ball or a rail.
  const maxStepDist = POOL_BALL_R * 0.5;

  for (let step = 0; step < MAX_SETTLE_STEPS; step++) {
    // Determine the fastest ball this outer step to size sub-steps.
    let maxSpeed = 0;
    for (const b of balls) {
      if (b.pocketed) continue;
      const s = Math.sqrt(speedSq(b));
      if (s > maxSpeed) maxSpeed = s;
    }
    if (maxSpeed < REST_SPEED) break; // everything at rest

    const travel = maxSpeed * dt;
    const sub = Math.max(1, Math.ceil(travel / maxStepDist));
    const sdt = dt / sub;

    for (let s = 0; s < sub; s++) {
      // 1. Integrate positions.
      for (const b of balls) {
        if (b.pocketed) continue;
        b.x += b.vx * sdt;
        b.y += b.vy * sdt;
      }

      // 2. Pocket capture (check before wall clamp so a ball heading into a
      //    corner pocket is sunk rather than bounced).
      for (const b of balls) {
        if (b.pocketed) continue;
        for (const p of POOL_POCKETS) {
          const dx = b.x - p.x;
          const dy = b.y - p.y;
          if (dx * dx + dy * dy <= POOL_POCKET_R * POOL_POCKET_R) {
            b.pocketed = true;
            b.vx = 0;
            b.vy = 0;
            pocketed.push(b.id);
            if (b.id === 0) cueScratched = true;
            break;
          }
        }
      }

      // 3. Cushion bounces (reflect + clamp inside the rails).
      for (const b of balls) {
        if (b.pocketed) continue;
        if (b.x < POOL_BALL_R) {
          b.x = POOL_BALL_R;
          b.vx = Math.abs(b.vx) * CUSHION_RESTITUTION;
          anyCushionHit = true;
        } else if (b.x > POOL_TABLE_W - POOL_BALL_R) {
          b.x = POOL_TABLE_W - POOL_BALL_R;
          b.vx = -Math.abs(b.vx) * CUSHION_RESTITUTION;
          anyCushionHit = true;
        }
        if (b.y < POOL_BALL_R) {
          b.y = POOL_BALL_R;
          b.vy = Math.abs(b.vy) * CUSHION_RESTITUTION;
          anyCushionHit = true;
        } else if (b.y > POOL_TABLE_H - POOL_BALL_R) {
          b.y = POOL_TABLE_H - POOL_BALL_R;
          b.vy = -Math.abs(b.vy) * CUSHION_RESTITUTION;
          anyCushionHit = true;
        }
      }

      // 4. Ball-ball collisions (pairwise; equal mass elastic along the normal).
      for (let i = 0; i < balls.length; i++) {
        const a = balls[i];
        if (a.pocketed) continue;
        for (let j = i + 1; j < balls.length; j++) {
          const c = balls[j];
          if (c.pocketed) continue;
          const dx = c.x - a.x;
          const dy = c.y - a.y;
          const distSq = dx * dx + dy * dy;
          if (distSq > TWO_R_SQ || distSq === 0) continue;

          const dist = Math.sqrt(distSq);
          const nx = dx / dist;
          const ny = dy / dist;

          // Positional separation so the balls never overlap (anti-tunnel).
          const overlap = TWO_R - dist;
          const half = overlap / 2;
          a.x -= nx * half;
          a.y -= ny * half;
          c.x += nx * half;
          c.y += ny * half;

          // Relative velocity along the normal.
          const rvx = c.vx - a.vx;
          const rvy = c.vy - a.vy;
          const velAlongNormal = rvx * nx + rvy * ny;
          if (velAlongNormal > 0) continue; // separating already

          // Equal mass elastic impulse: exchange the normal component.
          const impulse = -(1 + BALL_RESTITUTION) * velAlongNormal / 2;
          const ix = impulse * nx;
          const iy = impulse * ny;
          a.vx -= ix;
          a.vy -= iy;
          c.vx += ix;
          c.vy += iy;

          // Record the cue ball's first contact for foul detection.
          if (firstContactId === null && cue && !cue.pocketed) {
            if (a.id === 0) firstContactId = c.id;
            else if (c.id === 0) firstContactId = a.id;
          }
        }
      }
    }

    // 5. Apply rolling friction over the full outer dt (exponential decay).
    const decay = Math.pow(FRICTION_PER_SEC, dt);
    for (const b of balls) {
      if (b.pocketed) continue;
      b.vx *= decay;
      b.vy *= decay;
      if (speedSq(b) < REST_SPEED * REST_SPEED) {
        b.vx = 0;
        b.vy = 0;
      }
    }

    // 6. Record an animation frame (downsample to keep the payload small).
    if (step % 2 === 0) trajectory.push(frameOf(balls));
  }

  // Final rest frame.
  for (const b of balls) {
    if (!b.pocketed) {
      b.vx = 0;
      b.vy = 0;
    }
  }
  trajectory.push(frameOf(balls));

  return { balls, pocketed, cueScratched, firstContactId, anyCushionHit, trajectory };
}

/**
 * Set the cue ball's initial velocity from a shot (angle + power) and simulate to
 * rest. Pure. `angleRad` is measured from +x, increasing toward +y (clockwise on
 * screen). `power` is clamped to [0,1] and scaled by POOL_MAX_SHOT_SPEED.
 */
export function applyShot(
  input: PoolBall[],
  angleRad: number,
  power: number,
  dt: number = POOL_DT,
): SimResult {
  const balls = cloneBalls(input);
  const cue = balls.find((b) => b.id === 0);
  const p = Math.max(0, Math.min(1, power));
  if (cue && !cue.pocketed) {
    const speed = p * POOL_MAX_SHOT_SPEED;
    cue.vx = Math.cos(angleRad) * speed;
    cue.vy = Math.sin(angleRad) * speed;
  }
  return simulateToRest(balls, dt);
}

/** True when no non-pocketed ball is moving above the rest threshold. */
export function isAtRest(balls: PoolBall[]): boolean {
  for (const b of balls) {
    if (b.pocketed) continue;
    if (speedSq(b) >= REST_SPEED * REST_SPEED) return false;
  }
  return true;
}
