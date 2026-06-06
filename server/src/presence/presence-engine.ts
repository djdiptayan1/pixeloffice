// ---------------------------------------------------------------------------
// Presence engine — the heart of the product, kept PURE and framework-free.
//
// `resolvePresence` is a single deterministic function: it reads no clock and
// performs no I/O — the caller always passes `now`. This makes every priority
// rule exhaustively testable (see presence-engine.test.ts).
//
// Priority order (CONTRACT.md — encode EXACTLY):
//   1. not connected           -> OFFLINE     (SYSTEM)
//   2. active calendar meeting  -> IN_MEETING  (CALENDAR)  -- beats everything
//   3. manual FOCUS             -> FOCUS       (MANUAL)
//   4. joined an active event   -> BREAK       (EVENT)
//   5. manual BREAK             -> BREAK       (MANUAL)
//   6. manual AWAY              -> AWAY        (MANUAL)
//   7. inactive >= timeout      -> AWAY        (AUTO)
//   8. otherwise                -> AVAILABLE   (SYSTEM)
// ---------------------------------------------------------------------------

import { PresenceState, type PresenceSource } from "@pixeloffice/shared";

export type ManualStatus = "FOCUS" | "BREAK" | "AWAY" | null;

export interface PresenceInput {
  /** Is the session currently connected to the room? */
  connected: boolean;
  /** Manual override the user explicitly selected (AVAILABLE clears -> null). */
  manualStatus: ManualStatus;
  /** Does the calendar adapter report an active meeting right now? */
  inMeeting: boolean;
  /** Has the user joined a currently-active social event? */
  inBreakEvent: boolean;
  /** Epoch ms of the last activity (any C2S message). */
  lastActivityAt: number;
  /** Epoch ms "now", supplied by the caller (engine never reads the clock). */
  now: number;
  /** Inactivity window after which a user is auto-AWAY. */
  awayTimeoutMs: number;
}

export interface PresenceResult {
  state: PresenceState;
  source: PresenceSource;
}

export function resolvePresence(input: PresenceInput): PresenceResult {
  // 1. Offline beats everything.
  if (!input.connected) {
    return { state: PresenceState.OFFLINE, source: "SYSTEM" };
  }

  // 2. Active calendar meeting — highest live priority.
  if (input.inMeeting) {
    return { state: PresenceState.IN_MEETING, source: "CALENDAR" };
  }

  // 3. Manual FOCUS beats event-break and away.
  if (input.manualStatus === "FOCUS") {
    return { state: PresenceState.FOCUS, source: "MANUAL" };
  }

  // 4. Joined an active social event -> BREAK (EVENT source).
  if (input.inBreakEvent) {
    return { state: PresenceState.BREAK, source: "EVENT" };
  }

  // 5. Manual BREAK.
  if (input.manualStatus === "BREAK") {
    return { state: PresenceState.BREAK, source: "MANUAL" };
  }

  // 6. Manual AWAY.
  if (input.manualStatus === "AWAY") {
    return { state: PresenceState.AWAY, source: "MANUAL" };
  }

  // 7. Auto-away after inactivity (at or after the threshold).
  if (input.now - input.lastActivityAt >= input.awayTimeoutMs) {
    return { state: PresenceState.AWAY, source: "AUTO" };
  }

  // 8. Default.
  return { state: PresenceState.AVAILABLE, source: "SYSTEM" };
}
