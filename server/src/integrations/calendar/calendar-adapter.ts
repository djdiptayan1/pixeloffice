// ---------------------------------------------------------------------------
// Calendar integration boundary (Adapter Pattern, plan Layer 3).
//
// The presence service depends ONLY on this interface. A real
// GoogleCalendarAdapter (V1) / Microsoft365Adapter (V2) implements the same
// two methods. Integrations are optional: the service wraps every call in
// try/catch so a failing calendar never breaks the office (plan Principle 4).
// ---------------------------------------------------------------------------

import type { MeetingInfo } from "@pixeloffice/shared";

export interface CalendarAdapter {
  /** The user's currently-active meeting, or null. `nowMs` supplied by caller. */
  getCurrentMeeting(userId: string, nowMs: number): MeetingInfo | null;
  /** Upcoming (not yet started) meetings for the user, soonest first. */
  getUpcomingMeetings(userId: string, nowMs: number): MeetingInfo[];
}

export interface CreateMeetingInput {
  title: string;
  startsInMinutes: number;
  durationMinutes: number;
  /** sessionIds invited. Empty/omitted = everyone in the office. */
  participantIds?: string[];
}
