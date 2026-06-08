// ---------------------------------------------------------------------------
// Pool AI opponent (framework-free, deterministic given an injected PRNG).
//
// Strategy (simple geometry, no search): for each legal target ball of the AI's
// group (or any non-8 ball on an open table, or the 8 once cleared), compute the
// "ghost ball" position — where the cue must strike the target so the target
// heads toward a pocket — for the NEAREST reachable pocket, then aim the cue at
// that ghost ball. Pick the target/pocket pair with the best (shortest, most
// aligned) shot. Difficulty adds Gaussian-ish aim noise scaled by level; harder
// levels add LESS noise. Power scales with distance so the cue is not over-hit.
// ---------------------------------------------------------------------------

import {
  POOL_BALL_R,
  POOL_POCKETS,
  type PoolBall,
  type PoolGroup,
  type PoolShotInput,
  type PoolState,
} from "@pixeloffice/shared";
import { kindForId } from "./pool-setup";
import type { Prng } from "./prng";

export type PoolDifficulty = "easy" | "medium" | "hard";

/** Max aim noise (radians, +/-) per difficulty. Harder => tighter. */
const NOISE_BY_DIFFICULTY: Record<PoolDifficulty, number> = {
  easy: 0.18,
  medium: 0.09,
  hard: 0.035,
};

function groupOf(b: PoolBall): PoolGroup | null {
  if (b.kind === "solid") return "solid";
  if (b.kind === "stripe") return "stripe";
  return null;
}

/** Legal target balls for the AI given the current state. */
function legalTargets(state: PoolState, aiId: string): PoolBall[] {
  const live = state.balls.filter((b) => !b.pocketed && b.id !== 0);
  const group = state.assignedGroups[aiId];
  if (!group) {
    // Open table: any non-8 ball.
    return live.filter((b) => b.id !== 8);
  }
  const own = live.filter((b) => groupOf(b) === group);
  if (own.length > 0) return own;
  // Group cleared: legal to shoot the 8.
  return live.filter((b) => b.id === 8);
}

interface Candidate {
  targetId: number;
  aimX: number;
  aimY: number;
  /** Heuristic cost — lower is better (cue->ghost + target->pocket distance). */
  cost: number;
  /** Distance cue must travel to the ghost ball (for power scaling). */
  cueDist: number;
}

/**
 * Compute the best shot the AI can find. Returns a PoolShotInput. Deterministic
 * for a given (state, prng) pair. Always returns an in-bounds shot: if no clean
 * geometric shot exists it falls back to aiming at the nearest legal ball.
 */
export function pickShot(
  state: PoolState,
  aiId: string,
  difficulty: PoolDifficulty,
  rng: Prng,
): PoolShotInput {
  const cue = state.balls.find((b) => b.id === 0 && !b.pocketed);
  const targets = legalTargets(state, aiId);

  // Degenerate fallback: no cue or no targets -> a soft straight shot.
  if (!cue || targets.length === 0) {
    return { angleRad: 0, power: 0.3 };
  }

  let best: Candidate | null = null;

  for (const t of targets) {
    for (const pocket of POOL_POCKETS) {
      // Direction from target to pocket.
      const tpx = pocket.x - t.x;
      const tpy = pocket.y - t.y;
      const tpLen = Math.hypot(tpx, tpy);
      if (tpLen < 1e-6) continue;
      const ux = tpx / tpLen;
      const uy = tpy / tpLen;

      // Ghost ball: where the cue's center must be at contact (one ball-diameter
      // behind the target along the target->pocket line).
      const ghostX = t.x - ux * (POOL_BALL_R * 2);
      const ghostY = t.y - uy * (POOL_BALL_R * 2);

      const cgx = ghostX - cue.x;
      const cgy = ghostY - cue.y;
      const cueDist = Math.hypot(cgx, cgy);
      if (cueDist < 1e-6) continue;

      // Cut angle penalty: if the cue would have to push the target backwards
      // (the pocket is "behind" the contact), this shot is impossible — skip.
      // dot of cue->ghost direction with target->pocket direction must be > 0.
      const align = (cgx / cueDist) * ux + (cgy / cueDist) * uy;
      if (align <= 0.05) continue;

      // Cost: shorter + straighter is easier. Penalize thin cuts (low align).
      const cost = cueDist + tpLen + (1 - align) * 120;
      if (!best || cost < best.cost) {
        best = { targetId: t.id, aimX: ghostX, aimY: ghostY, cost, cueDist };
      }
    }
  }

  // Fallback: aim straight at the nearest legal ball.
  if (!best) {
    let nearest = targets[0];
    let nd = Infinity;
    for (const t of targets) {
      const d = Math.hypot(t.x - cue.x, t.y - cue.y);
      if (d < nd) {
        nd = d;
        nearest = t;
      }
    }
    best = { targetId: nearest.id, aimX: nearest.x, aimY: nearest.y, cost: nd, cueDist: nd };
  }

  let angle = Math.atan2(best.aimY - cue.y, best.aimX - cue.x);

  // Aim noise from the injected PRNG (centered). Harder difficulty => less noise.
  const noiseMax = NOISE_BY_DIFFICULTY[difficulty];
  const noise = (rng() - 0.5) * 2 * noiseMax;
  angle += noise;

  // Power scales with the cue->ghost distance plus the target->pocket run, so
  // the AI strikes hard enough to reach the pocket but not max every time.
  const reach = best.cueDist + best.cost * 0.25;
  let power = 0.35 + reach / 320;
  power = Math.max(0.25, Math.min(1, power));

  return { angleRad: angle, power };
}
