// ---------------------------------------------------------------------------
// Presence service — runtime orchestration around the pure presence engine.
//
// Holds per-session records (the ONLY thing tracked, plus explicit status —
// no surveillance). On each tick it resolves presence for every session via
// the pure engine, the CalendarAdapter, and the EventService, then emits
// "change" only when state/source actually changes. It also detects meeting
// start/end per session and emits "meeting-started" / "meeting-ended".
//
// Framework-independent: imports no Colyseus. Never reads the system clock —
// callers (room, tests) always pass `nowMs`.
// ---------------------------------------------------------------------------

import { EventEmitter } from "node:events";
import {
  PresenceState,
  type MeetingInfo,
  type PresenceSource,
} from "@pixeloffice/shared";
import { resolvePresence, type ManualStatus } from "./presence-engine";
import type { CalendarAdapter } from "../integrations/calendar/calendar-adapter";
import type { EventService } from "../events/event.service";

interface SessionRecord {
  sessionId: string;
  userId: string;
  manualStatus: ManualStatus;
  lastActivityAt: number;
  lastState: PresenceState;
  lastSource: PresenceSource;
  currentMeetingId: string | null;
}

const DEFAULT_AWAY_TIMEOUT_MS = 90_000;

export interface PresenceChange {
  sessionId: string;
  state: PresenceState;
  source: PresenceSource;
}

/**
 * Emits:
 *   "change"          ({ sessionId, state, source })  — only on actual change
 *   "meeting-started" ({ sessionId, meeting })        — calendar meeting begins
 *   "meeting-ended"   ({ sessionId, meetingId })      — calendar meeting ends
 */
export class PresenceService extends EventEmitter {
  private readonly records = new Map<string, SessionRecord>();
  private readonly awayTimeoutMs: number;

  constructor(
    private readonly calendar: CalendarAdapter,
    private readonly events: EventService,
    awayTimeoutMs: number = readAwayTimeout(),
  ) {
    super();
    this.awayTimeoutMs = awayTimeoutMs;
  }

  /** Start tracking a session. Initialises as OFFLINE until first resolve. */
  track(sessionId: string, userId: string, nowMs: number): void {
    this.records.set(sessionId, {
      sessionId,
      userId,
      manualStatus: null,
      lastActivityAt: nowMs,
      lastState: PresenceState.OFFLINE,
      lastSource: "SYSTEM",
      currentMeetingId: null,
    });
  }

  untrack(sessionId: string): void {
    this.records.delete(sessionId);
  }

  /** Record activity (any C2S message clears auto-AWAY). */
  activity(sessionId: string, nowMs: number): void {
    const rec = this.records.get(sessionId);
    if (rec) rec.lastActivityAt = nowMs;
  }

  /** Apply an explicit status. "AVAILABLE" clears the manual override. */
  setManual(sessionId: string, state: "AVAILABLE" | "FOCUS" | "BREAK" | "AWAY"): void {
    const rec = this.records.get(sessionId);
    if (!rec) return;
    rec.manualStatus = state === "AVAILABLE" ? null : state;
  }

  /** Current resolved presence for a session (last computed), or null. */
  getPresence(sessionId: string): { state: PresenceState; source: PresenceSource } | null {
    const rec = this.records.get(sessionId);
    if (!rec) return null;
    return { state: rec.lastState, source: rec.lastSource };
  }

  /**
   * Resolve presence for every tracked session. Emits "change" on change and
   * meeting start/end transitions. The calendar call is wrapped in try/catch:
   * a failing integration must never break the office (plan Principle 4).
   */
  tick(nowMs: number): void {
    for (const rec of this.records.values()) {
      let meeting: MeetingInfo | null = null;
      try {
        // Meetings target the STABLE user identity (not the ephemeral
        // sessionId) so a real calendar adapter is a drop-in replacement.
        meeting = this.calendar.getCurrentMeeting(rec.userId, nowMs);
      } catch {
        meeting = null; // degrade gracefully
      }

      let inBreakEvent = false;
      try {
        inBreakEvent = this.events.isInActiveEvent(rec.sessionId, nowMs);
      } catch {
        inBreakEvent = false;
      }

      const result = resolvePresence({
        connected: true,
        manualStatus: rec.manualStatus,
        inMeeting: meeting !== null,
        inBreakEvent,
        lastActivityAt: rec.lastActivityAt,
        now: nowMs,
        awayTimeoutMs: this.awayTimeoutMs,
      });

      // Meeting start/end detection per session.
      const newMeetingId = meeting ? meeting.id : null;
      if (newMeetingId !== rec.currentMeetingId) {
        const previous = rec.currentMeetingId;
        rec.currentMeetingId = newMeetingId;
        if (newMeetingId && meeting) {
          this.emit("meeting-started", { sessionId: rec.sessionId, meeting });
        } else if (previous) {
          this.emit("meeting-ended", { sessionId: rec.sessionId, meetingId: previous });
        }
      }

      if (result.state !== rec.lastState || result.source !== rec.lastSource) {
        rec.lastState = result.state;
        rec.lastSource = result.source;
        this.emit("change", {
          sessionId: rec.sessionId,
          state: result.state,
          source: result.source,
        } satisfies PresenceChange);
      }
    }
  }
}

function readAwayTimeout(): number {
  const raw = process.env.AWAY_TIMEOUT_MS;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_AWAY_TIMEOUT_MS;
}
