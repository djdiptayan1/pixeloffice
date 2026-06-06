// ---------------------------------------------------------------------------
// CompositeCalendarAdapter — overlays a real (Google) calendar on top of the
// in-memory mock. Kept deliberately DUMB:
//   * Google is queried FIRST for a connected user. If it yields a meeting, use
//     it. Otherwise fall back to the mock (admin-scheduled dev meetings still
//     work, AND real Google meetings overlay them).
//   * Upcoming meetings are the union (Google first, then mock), soonest first.
//
// This keeps the zero-config dev path intact (admin REST meetings) while letting
// real Google meetings drive presence for users who connected their calendar.
// Framework-free; depends only on the CalendarAdapter interface.
// ---------------------------------------------------------------------------

import type { MeetingInfo } from "@pixeloffice/shared";
import type { CalendarAdapter } from "./calendar-adapter";

export class CompositeCalendarAdapter implements CalendarAdapter {
  constructor(
    private readonly primary: CalendarAdapter,
    private readonly secondary: CalendarAdapter,
  ) {}

  getCurrentMeeting(userId: string, nowMs: number): MeetingInfo | null {
    return (
      this.primary.getCurrentMeeting(userId, nowMs) ??
      this.secondary.getCurrentMeeting(userId, nowMs)
    );
  }

  getUpcomingMeetings(userId: string, nowMs: number): MeetingInfo[] {
    const merged = [
      ...this.primary.getUpcomingMeetings(userId, nowMs),
      ...this.secondary.getUpcomingMeetings(userId, nowMs),
    ];
    return merged.sort((a, b) => a.startTime - b.startTime);
  }
}
