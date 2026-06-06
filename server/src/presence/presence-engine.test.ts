import { describe, expect, it } from "vitest";
import { PresenceState } from "@pixeloffice/shared";
import { resolvePresence, type PresenceInput } from "./presence-engine";

const AWAY = 90000;
const NOW = 1_000_000;

/** Build an input with sensible "available, just active" defaults. */
function base(overrides: Partial<PresenceInput> = {}): PresenceInput {
  return {
    connected: true,
    manualStatus: null,
    inMeeting: false,
    inBreakEvent: false,
    lastActivityAt: NOW, // active right now
    now: NOW,
    awayTimeoutMs: AWAY,
    ...overrides,
  };
}

describe("resolvePresence — priority order", () => {
  it("1. not connected => OFFLINE/SYSTEM (beats all)", () => {
    const r = resolvePresence(
      base({
        connected: false,
        inMeeting: true,
        manualStatus: "FOCUS",
        inBreakEvent: true,
        lastActivityAt: 0,
      }),
    );
    expect(r).toEqual({ state: PresenceState.OFFLINE, source: "SYSTEM" });
  });

  it("2. active meeting => IN_MEETING/CALENDAR, beats focus", () => {
    const r = resolvePresence(base({ inMeeting: true, manualStatus: "FOCUS" }));
    expect(r).toEqual({ state: PresenceState.IN_MEETING, source: "CALENDAR" });
  });

  it("2. active meeting beats event-break and manual-break", () => {
    const r = resolvePresence(base({ inMeeting: true, inBreakEvent: true, manualStatus: "BREAK" }));
    expect(r).toEqual({ state: PresenceState.IN_MEETING, source: "CALENDAR" });
  });

  it("2. active meeting beats auto-away", () => {
    const r = resolvePresence(base({ inMeeting: true, lastActivityAt: NOW - AWAY * 2 }));
    expect(r).toEqual({ state: PresenceState.IN_MEETING, source: "CALENDAR" });
  });

  it("3. manual FOCUS => FOCUS/MANUAL, beats event-break", () => {
    const r = resolvePresence(base({ manualStatus: "FOCUS", inBreakEvent: true }));
    expect(r).toEqual({ state: PresenceState.FOCUS, source: "MANUAL" });
  });

  it("4. in event (no focus) => BREAK/EVENT, beats manual BREAK", () => {
    const r = resolvePresence(base({ inBreakEvent: true, manualStatus: "BREAK" }));
    expect(r).toEqual({ state: PresenceState.BREAK, source: "EVENT" });
  });

  it("4. in event beats auto-away", () => {
    const r = resolvePresence(base({ inBreakEvent: true, lastActivityAt: NOW - AWAY * 2 }));
    expect(r).toEqual({ state: PresenceState.BREAK, source: "EVENT" });
  });

  it("5. manual BREAK (no event) => BREAK/MANUAL", () => {
    const r = resolvePresence(base({ manualStatus: "BREAK" }));
    expect(r).toEqual({ state: PresenceState.BREAK, source: "MANUAL" });
  });

  it("6. manual AWAY => AWAY/MANUAL, beats auto-away timing", () => {
    const r = resolvePresence(base({ manualStatus: "AWAY", lastActivityAt: NOW }));
    expect(r).toEqual({ state: PresenceState.AWAY, source: "MANUAL" });
  });

  it("7. auto-away exactly AT the threshold => AWAY/AUTO", () => {
    const r = resolvePresence(base({ lastActivityAt: NOW - AWAY }));
    expect(r).toEqual({ state: PresenceState.AWAY, source: "AUTO" });
  });

  it("7. auto-away AFTER the threshold => AWAY/AUTO", () => {
    const r = resolvePresence(base({ lastActivityAt: NOW - AWAY - 1 }));
    expect(r).toEqual({ state: PresenceState.AWAY, source: "AUTO" });
  });

  it("7. NOT auto-away just BEFORE the threshold => AVAILABLE/SYSTEM", () => {
    const r = resolvePresence(base({ lastActivityAt: NOW - AWAY + 1 }));
    expect(r).toEqual({ state: PresenceState.AVAILABLE, source: "SYSTEM" });
  });

  it("8. default => AVAILABLE/SYSTEM", () => {
    const r = resolvePresence(base());
    expect(r).toEqual({ state: PresenceState.AVAILABLE, source: "SYSTEM" });
  });
});

describe("resolvePresence — key transitions", () => {
  it("activity clears auto-away (AWAY -> AVAILABLE)", () => {
    const stale = resolvePresence(base({ lastActivityAt: NOW - AWAY }));
    expect(stale.state).toBe(PresenceState.AWAY);
    const fresh = resolvePresence(base({ lastActivityAt: NOW }));
    expect(fresh).toEqual({ state: PresenceState.AVAILABLE, source: "SYSTEM" });
  });

  it("manual AVAILABLE (override cleared = null) => AVAILABLE/SYSTEM", () => {
    const r = resolvePresence(base({ manualStatus: null }));
    expect(r).toEqual({ state: PresenceState.AVAILABLE, source: "SYSTEM" });
  });

  it("meeting ending while still in a break event => BREAK/EVENT", () => {
    const during = resolvePresence(base({ inMeeting: true, inBreakEvent: true }));
    expect(during.state).toBe(PresenceState.IN_MEETING);
    const after = resolvePresence(base({ inMeeting: false, inBreakEvent: true }));
    expect(after).toEqual({ state: PresenceState.BREAK, source: "EVENT" });
  });

  it("meeting ending while manual FOCUS => FOCUS/MANUAL", () => {
    const after = resolvePresence(base({ inMeeting: false, manualStatus: "FOCUS" }));
    expect(after).toEqual({ state: PresenceState.FOCUS, source: "MANUAL" });
  });

  it("event ending while no override and active => AVAILABLE/SYSTEM", () => {
    const after = resolvePresence(base({ inBreakEvent: false }));
    expect(after).toEqual({ state: PresenceState.AVAILABLE, source: "SYSTEM" });
  });
});
