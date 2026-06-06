// ---------------------------------------------------------------------------
// Social event engine (coffee breaks, gatherings, town halls).
// Framework-independent: emits domain events; the room translates them to wire
// messages. Never reads the system clock itself — callers pass `nowMs`.
// ---------------------------------------------------------------------------

import { EventEmitter } from "node:events";
import {
  EVENT_AREA,
  SOCIAL_EVENT_TYPES,
  type SocialEvent,
  type SocialEventType,
} from "@pixeloffice/shared";

export interface JoinResult {
  event: SocialEvent;
  /** Position in participantIds — used to pick the seating anchor. */
  anchorIndex: number;
}

let eventSeq = 0;

export function isSocialEventType(value: unknown): value is SocialEventType {
  return typeof value === "string" && (SOCIAL_EVENT_TYPES as readonly string[]).includes(value);
}

/**
 * Emits:
 *   "created" (event: SocialEvent)
 *   "updated" (event: SocialEvent)   — on join/leave
 *   "ended"   (eventId: string)      — on expiry
 */
export class EventService extends EventEmitter {
  private readonly events = new Map<string, SocialEvent>();

  createEvent(type: SocialEventType, title: string, durationMinutes: number, nowMs: number): SocialEvent {
    const start = nowMs;
    const event: SocialEvent = {
      id: `event_${Date.now()}_${eventSeq++}`,
      type,
      title,
      areaName: EVENT_AREA[type],
      startTime: start,
      endTime: start + Math.round(durationMinutes * 60_000),
      participantIds: [],
    };
    this.events.set(event.id, event);
    this.emit("created", event);
    return event;
  }

  /** Active (not expired) events as of `nowMs`. */
  activeEvents(nowMs: number): SocialEvent[] {
    return Array.from(this.events.values()).filter((e) => nowMs < e.endTime);
  }

  getEvent(eventId: string): SocialEvent | null {
    return this.events.get(eventId) ?? null;
  }

  join(eventId: string, sessionId: string): JoinResult | null {
    const event = this.events.get(eventId);
    if (!event) return null;
    let anchorIndex = event.participantIds.indexOf(sessionId);
    if (anchorIndex === -1) {
      event.participantIds.push(sessionId);
      anchorIndex = event.participantIds.length - 1;
      this.emit("updated", event);
    }
    return { event, anchorIndex };
  }

  leave(eventId: string, sessionId: string): SocialEvent | null {
    const event = this.events.get(eventId);
    if (!event) return null;
    const idx = event.participantIds.indexOf(sessionId);
    if (idx !== -1) {
      event.participantIds.splice(idx, 1);
      this.emit("updated", event);
    }
    return event;
  }

  /** Drop a session from every event it joined (on disconnect). */
  removeParticipant(sessionId: string): void {
    for (const event of this.events.values()) {
      const idx = event.participantIds.indexOf(sessionId);
      if (idx !== -1) {
        event.participantIds.splice(idx, 1);
        this.emit("updated", event);
      }
    }
  }

  /** Is this session currently in any active (not-yet-expired) event as of `nowMs`? */
  isInActiveEvent(sessionId: string, nowMs: number): boolean {
    for (const event of this.events.values()) {
      if (nowMs < event.endTime && event.participantIds.includes(sessionId)) return true;
    }
    return false;
  }

  /** Expire events whose endTime has passed; emits "ended" and removes them. */
  tick(nowMs: number): void {
    for (const [id, event] of this.events) {
      if (nowMs >= event.endTime) {
        this.events.delete(id);
        this.emit("ended", id);
      }
    }
  }
}
