// ---------------------------------------------------------------------------
// CompositeCalendarAdapter — overlay semantics for the meeting-board list:
// Google (primary) wins, mock (secondary) fills gaps, dedupe by id.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import type { MeetingInfo } from "@pixeloffice/shared";
import { CompositeCalendarAdapter } from "./composite-calendar.adapter";
import type { CalendarAdapter } from "./calendar-adapter";

const NOW = 1_000_000;

function fake(meetings: MeetingInfo[]): CalendarAdapter {
  return {
    getCurrentMeeting() {
      return null;
    },
    getUpcomingMeetings() {
      return [];
    },
    getMeetings() {
      return [...meetings];
    },
  };
}

function m(id: string, startTime: number): MeetingInfo {
  return {
    id,
    title: id,
    startTime,
    endTime: startTime + 60_000,
    participantIds: [],
    roomName: "Meeting Room C",
  };
}

describe("CompositeCalendarAdapter — getMeetings", () => {
  it("unions primary + secondary, soonest-first", () => {
    const primary = fake([m("g2", NOW + 2000), m("g1", NOW)]);
    const secondary = fake([m("mock", NOW + 1000)]);
    const c = new CompositeCalendarAdapter(primary, secondary);
    expect(c.getMeetings("u", NOW).map((x) => x.id)).toEqual(["g1", "mock", "g2"]);
  });

  it("dedupes by id, keeping the primary copy", () => {
    const g = m("dup", NOW);
    g.title = "Google copy";
    const primary = fake([g]);
    const mock = m("dup", NOW);
    mock.title = "Mock shadow";
    const c = new CompositeCalendarAdapter(primary, fake([mock]));
    const out = c.getMeetings("u", NOW);
    expect(out.length).toBe(1);
    expect(out[0].title).toBe("Google copy");
  });

  it("primary list wins even when empty (mock only fills gaps)", () => {
    const primary = fake([]);
    const secondary = fake([m("mock", NOW)]);
    const c = new CompositeCalendarAdapter(primary, secondary);
    expect(c.getMeetings("u", NOW).map((x) => x.id)).toEqual(["mock"]);
  });
});
