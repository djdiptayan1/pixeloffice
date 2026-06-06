// ---------------------------------------------------------------------------
// In-memory mock calendar. Trivially replaceable by a GoogleCalendarAdapter:
// it holds a plain array of meetings and answers the CalendarAdapter queries
// from it. Admin REST seeds meetings via `createMeeting`.
//
// Identity note: meetings target sessionIds (the office's live identity). An
// empty `participantIds` means "everyone in the office". The presence engine
// queries per session, so the room passes a sessionId as the lookup id here.
// The parameter is named `id` to make that explicit.
// ---------------------------------------------------------------------------

import type { MeetingInfo } from "@pixeloffice/shared";
import type { CalendarAdapter, CreateMeetingInput } from "./calendar-adapter";

let meetingSeq = 0;

/** Room assignment by invitee count (CONTRACT.md). 0/empty = everyone -> Room C. */
export function assignMeetingRoom(participantCount: number): string {
  if (participantCount === 0) return "Meeting Room C"; // everyone
  if (participantCount <= 4) return "Meeting Room A";
  if (participantCount <= 8) return "Meeting Room B";
  return "Meeting Room C";
}

export class MockCalendarAdapter implements CalendarAdapter {
  private readonly meetings: MeetingInfo[] = [];

  /** Does this meeting apply to the given identity right now? Empty = everyone. */
  private appliesTo(meeting: MeetingInfo, id: string): boolean {
    return meeting.participantIds.length === 0 || meeting.participantIds.includes(id);
  }

  getCurrentMeeting(id: string, nowMs: number): MeetingInfo | null {
    for (const m of this.meetings) {
      if (m.startTime <= nowMs && nowMs < m.endTime && this.appliesTo(m, id)) {
        return m;
      }
    }
    return null;
  }

  getUpcomingMeetings(id: string, nowMs: number): MeetingInfo[] {
    return this.meetings
      .filter((m) => m.startTime > nowMs && this.appliesTo(m, id))
      .sort((a, b) => a.startTime - b.startTime);
  }

  /** All meetings active at `nowMs` regardless of participant (room helper). */
  activeMeetings(nowMs: number): MeetingInfo[] {
    return this.meetings.filter((m) => m.startTime <= nowMs && nowMs < m.endTime);
  }

  /** Admin REST entry point. Returns the created meeting. */
  createMeeting(input: CreateMeetingInput, nowMs: number): MeetingInfo {
    const participantIds = Array.isArray(input.participantIds) ? [...input.participantIds] : [];
    const startTime = nowMs + Math.round(input.startsInMinutes * 60_000);
    const endTime = startTime + Math.round(input.durationMinutes * 60_000);
    const meeting: MeetingInfo = {
      id: `meeting_${Date.now()}_${meetingSeq++}`,
      title: input.title,
      startTime,
      endTime,
      participantIds,
      roomName: assignMeetingRoom(participantIds.length),
    };
    this.meetings.push(meeting);
    return meeting;
  }
}
