import { describe, expect, it } from "vitest";
import { MockCalendarAdapter, assignMeetingRoom } from "./mock-calendar.adapter";

const NOW = 1_000_000;
const MIN = 60_000;

describe("MockCalendarAdapter — active window (half-open [start, end))", () => {
  it("is active exactly AT startTime and NOT active exactly at endTime", () => {
    const cal = new MockCalendarAdapter();
    // starts now, 1 minute long -> [NOW, NOW+60000)
    const m = cal.createMeeting({ title: "Standup", startsInMinutes: 0, durationMinutes: 1 }, NOW);
    expect(cal.getCurrentMeeting("u", m.startTime)?.id).toBe(m.id); // at start: active
    expect(cal.getCurrentMeeting("u", m.endTime - 1)?.id).toBe(m.id); // just before end
    expect(cal.getCurrentMeeting("u", m.endTime)).toBeNull(); // at end: NOT active
  });

  it("empty participantIds applies to ANY user; a specific list does not", () => {
    const cal = new MockCalendarAdapter();
    const everyone = cal.createMeeting({ title: "All Hands", startsInMinutes: 0, durationMinutes: 5 }, NOW);
    expect(cal.getCurrentMeeting("anyone", NOW)?.id).toBe(everyone.id);

    const cal2 = new MockCalendarAdapter();
    cal2.createMeeting({ title: "1:1", startsInMinutes: 0, durationMinutes: 5, participantIds: ["alice"] }, NOW);
    expect(cal2.getCurrentMeeting("bob", NOW)).toBeNull();
    expect(cal2.getCurrentMeeting("alice", NOW)?.title).toBe("1:1");
  });
});

describe("MockCalendarAdapter — overlap tie-break", () => {
  it("prefers a specific invite over an 'everyone' meeting created earlier", () => {
    const cal = new MockCalendarAdapter();
    cal.createMeeting({ title: "Everyone", startsInMinutes: 0, durationMinutes: 10 }, NOW);
    const specific = cal.createMeeting(
      { title: "Just S", startsInMinutes: 0, durationMinutes: 10, participantIds: ["s"] },
      NOW,
    );
    // User 's' must see the specific invite, not the (earlier) everyone meeting.
    expect(cal.getCurrentMeeting("s", NOW)?.id).toBe(specific.id);
    // A user NOT in the specific invite still sees the everyone meeting.
    expect(cal.getCurrentMeeting("other", NOW)?.title).toBe("Everyone");
  });

  it("among two overlapping 'everyone' meetings, the most-recently-started wins", () => {
    const cal = new MockCalendarAdapter();
    cal.createMeeting({ title: "Older", startsInMinutes: 0, durationMinutes: 10 }, NOW);
    const newer = cal.createMeeting({ title: "Newer", startsInMinutes: 1, durationMinutes: 10 }, NOW);
    // At a time both are active, prefer the one that started most recently.
    expect(cal.getCurrentMeeting("u", NOW + 2 * MIN)?.id).toBe(newer.id);
  });
});

describe("MockCalendarAdapter — upcoming", () => {
  it("excludes a meeting whose startTime == now and sorts soonest-first", () => {
    const cal = new MockCalendarAdapter();
    const soon = cal.createMeeting({ title: "Soon", startsInMinutes: 5, durationMinutes: 5 }, NOW);
    const later = cal.createMeeting({ title: "Later", startsInMinutes: 30, durationMinutes: 5 }, NOW);
    cal.createMeeting({ title: "NowStart", startsInMinutes: 0, durationMinutes: 5 }, NOW);

    const upcoming = cal.getUpcomingMeetings("u", NOW);
    // startTime == now is NOT upcoming (strictly > now).
    expect(upcoming.map((m) => m.id)).toEqual([soon.id, later.id]);
  });
});

describe("MockCalendarAdapter — createMeeting validation + room assignment", () => {
  it("rejects a zero/negative duration (could never become active)", () => {
    const cal = new MockCalendarAdapter();
    expect(() => cal.createMeeting({ title: "z", startsInMinutes: 0, durationMinutes: 0 }, NOW)).toThrow();
    expect(() => cal.createMeeting({ title: "z", startsInMinutes: 0, durationMinutes: -5 }, NOW)).toThrow();
  });

  it("rejects a negative start offset", () => {
    const cal = new MockCalendarAdapter();
    expect(() => cal.createMeeting({ title: "z", startsInMinutes: -1, durationMinutes: 5 }, NOW)).toThrow();
  });

  it("assigns rooms by invitee count at the boundaries", () => {
    expect(assignMeetingRoom(0)).toBe("Meeting Room C"); // everyone
    expect(assignMeetingRoom(1)).toBe("Meeting Room A");
    expect(assignMeetingRoom(4)).toBe("Meeting Room A");
    expect(assignMeetingRoom(5)).toBe("Meeting Room B");
    expect(assignMeetingRoom(8)).toBe("Meeting Room B");
    expect(assignMeetingRoom(9)).toBe("Meeting Room C");
  });
});
