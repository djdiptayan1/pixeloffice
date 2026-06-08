// ---------------------------------------------------------------------------
// 8-ball rules engine (framework-free, deterministic, pure).
//
// Given the state BEFORE a shot, the two players (sessionIds) and the SimResult
// produced by the physics, it computes the new PoolState: group assignment on an
// open table, foul detection, turn passing, ball-in-hand, and win/lose.
//
// Rules implemented (standard-ish 8-ball, simplified for a lounge game):
//   - OPEN TABLE until the first legal pot of a non-8 ball assigns groups
//     (shooter -> the group they potted, opponent -> the other).
//   - You must hit a ball of YOUR group FIRST (once assigned). Otherwise FOUL.
//     On an OPEN table, hitting any non-8 ball first is legal; hitting the 8
//     first is a foul.
//   - Cue scratch (cue pocketed) = FOUL -> opponent gets ball-in-hand.
//   - No-contact (cue hit nothing) = FOUL.
//   - Pot the 8 only AFTER clearing your whole group. Potting the 8 early, OR
//     potting the 8 on a foul, OR scratching while potting the 8 = LOSS.
//     Legally potting the 8 after clearing your group = WIN.
//   - Turn PASSES to the opponent unless the shooter legally potted at least one
//     ball of their group (and did not foul) — then they keep shooting.
// ---------------------------------------------------------------------------

import type {
  PoolBall,
  PoolGroup,
  PoolShotEvent,
  PoolState,
} from "@pixeloffice/shared";
import { kindForId } from "./pool-setup";
import type { SimResult } from "./pool-physics";

export interface ApplyShotResult {
  state: PoolState;
  event: PoolShotEvent;
  /** Set when the game is over. */
  winnerSessionId?: string | null;
}

function groupOfKind(kind: PoolBall["kind"]): PoolGroup | null {
  if (kind === "solid") return "solid";
  if (kind === "stripe") return "stripe";
  return null;
}

/** Count remaining (not pocketed) balls of a group. */
function remainingInGroup(balls: PoolBall[], group: PoolGroup): number {
  let n = 0;
  for (const b of balls) {
    if (b.pocketed) continue;
    if (groupOfKind(b.kind) === group) n++;
  }
  return n;
}

/**
 * Resolve a completed shot under 8-ball rules.
 *
 * @param prev       state BEFORE the shot (used for assignments + turn).
 * @param shooter    sessionId (or "AI") who took the shot.
 * @param opponent   the other player's sessionId (or "AI").
 * @param sim        the physics result of the shot.
 */
export function resolveShot(
  prev: PoolState,
  shooter: string,
  opponent: string,
  sim: SimResult,
): ApplyShotResult {
  const balls = sim.balls;
  const assigned = { ...prev.assignedGroups };
  const tableOpen = Object.keys(assigned).length === 0;
  const shooterGroup: PoolGroup | undefined = assigned[shooter];

  const pottedNon8 = sim.pocketed.filter((id) => id !== 0 && id !== 8);
  const potted8 = sim.pocketed.includes(8);

  // --- Foul detection ------------------------------------------------------
  let foul = false;
  let reason = "potted";

  // Cue scratch.
  if (sim.cueScratched) {
    foul = true;
    reason = "scratch";
  }

  // No contact at all.
  if (sim.firstContactId === null) {
    foul = true;
    reason = "foul";
  } else {
    // Wrong-group first contact.
    const firstKind = kindForId(sim.firstContactId);
    if (tableOpen) {
      // On an open table only hitting the 8 first is a foul.
      if (firstKind === "eight") {
        foul = true;
        reason = "foul";
      }
    } else if (shooterGroup) {
      const firstGroup = groupOfKind(firstKind);
      // Must hit own group first, UNLESS the shooter has cleared their group and
      // is legally going for the 8 (then hitting the 8 first is allowed).
      const cleared = remainingInGroupBefore(prev.balls, shooterGroup) === 0;
      if (firstKind === "eight") {
        if (!cleared) {
          foul = true;
          reason = "foul";
        }
      } else if (firstGroup !== shooterGroup) {
        foul = true;
        reason = "foul";
      }
    }
  }

  // --- 8-ball win/lose -----------------------------------------------------
  if (potted8) {
    // Determine if the shooter had cleared their group BEFORE this shot.
    const grp = shooterGroup;
    let legal8 = false;
    if (!tableOpen && grp) {
      const clearedBefore = remainingInGroupBefore(prev.balls, grp) === 0;
      legal8 = clearedBefore && !foul && !sim.cueScratched;
    }
    if (legal8) {
      const event: PoolShotEvent = {
        potted: sim.pocketed,
        scratch: sim.cueScratched,
        foul,
        firstContactId: sim.firstContactId,
        winnerSessionId: shooter,
        reason: "win",
      };
      return {
        state: finalState(prev, balls, assigned, shooter, false, event),
        event,
        winnerSessionId: shooter,
      };
    }
    // Illegal 8 (early, or on a foul/scratch) => shooter LOSES.
    const event: PoolShotEvent = {
      potted: sim.pocketed,
      scratch: sim.cueScratched,
      foul: true,
      firstContactId: sim.firstContactId,
      winnerSessionId: opponent,
      reason: "illegal-8-loss",
    };
    return {
      state: finalState(prev, balls, assigned, opponent, false, event),
      event,
      winnerSessionId: opponent,
    };
  }

  // --- Open-table group assignment ----------------------------------------
  // The table opens to the shooter's group on a LEGAL pot of a non-8 ball.
  let newlyAssigned = false;
  if (tableOpen && pottedNon8.length > 0 && !foul) {
    // Assign the group of the FIRST legally potted non-8 ball to the shooter.
    const firstPottedKind = kindForId(pottedNon8[0]);
    const grp = groupOfKind(firstPottedKind);
    if (grp) {
      assigned[shooter] = grp;
      assigned[opponent] = grp === "solid" ? "stripe" : "solid";
      newlyAssigned = true;
    }
  }

  // --- Turn logic ----------------------------------------------------------
  // The shooter keeps the table only if they legally potted a ball of THEIR
  // group (after assignment) and did not foul. A foul always passes the turn and
  // grants ball-in-hand to the opponent.
  let keepTurn = false;
  if (!foul) {
    const myGroup = assigned[shooter];
    if (myGroup) {
      const pottedOwn = pottedNon8.some((id) => groupOfKind(kindForId(id)) === myGroup);
      keepTurn = pottedOwn;
    } else {
      // Still open after the shot (no legal pot): potting anything keeps turn
      // only if a group was just assigned; otherwise pass.
      keepTurn = newlyAssigned;
    }
  }

  const nextTurn = keepTurn ? shooter : opponent;
  const ballInHand = foul; // opponent gets ball-in-hand after a foul.

  const event: PoolShotEvent = {
    potted: sim.pocketed,
    scratch: sim.cueScratched,
    foul,
    firstContactId: sim.firstContactId,
    reason: foul ? reason : pottedNon8.length > 0 ? "potted" : "miss",
  };

  return {
    state: finalState(prev, balls, assigned, nextTurn, ballInHand, event),
    event,
  };
}

function remainingInGroupBefore(prevBalls: PoolBall[], group: PoolGroup): number {
  return remainingInGroup(prevBalls, group);
}

function finalState(
  prev: PoolState,
  balls: PoolBall[],
  assigned: Record<string, PoolGroup>,
  nextTurn: string,
  ballInHand: boolean,
  event: PoolShotEvent,
): PoolState {
  return {
    balls,
    currentTurn: nextTurn,
    assignedGroups: assigned,
    ballInHand,
    lastEvent: event,
    animating: false,
    // trajectory is attached by the room from the SimResult for animation.
  };
}
