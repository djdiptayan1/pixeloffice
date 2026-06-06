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
  /** Stable seat slot (lowest free index) — used to pick the seating anchor. */
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
  /** Per-event stable seat slots: eventId -> (sessionId -> slotIndex). */
  private readonly slots = new Map<string, Map<string, number>>();

  createEvent(type: SocialEventType, title: string, durationMinutes: number, nowMs: number): SocialEvent {
    const start = nowMs;
    const event: SocialEvent = {
      // Derive the id from the injected clock (honors the "never reads the
      // system clock" contract and keeps ids deterministic under test).
      id: `event_${nowMs}_${eventSeq++}`,
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

  /**
   * Join an event. `nowMs` rejects an already-expired event (the lazy tick may
   * not have removed it yet). The seat slot is the LOWEST FREE index and is
   * stable across re-joins — deriving it from array push position would hand a
   * new joiner an index a still-seated participant occupies after a leave.
   */
  join(eventId: string, sessionId: string, nowMs: number): JoinResult | null {
    const event = this.events.get(eventId);
    if (!event) return null;
    if (nowMs >= event.endTime) return null; // expired-but-not-yet-swept
    const anchorIndex = this.assignSlot(eventId, sessionId);
    if (!event.participantIds.includes(sessionId)) {
      event.participantIds.push(sessionId);
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
      this.releaseSlot(eventId, sessionId);
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
        this.releaseSlot(event.id, sessionId);
        this.emit("updated", event);
      }
    }
  }

  /** Lowest-free stable seat slot for a session in an event (idempotent). */
  private assignSlot(eventId: string, sessionId: string): number {
    let slots = this.slots.get(eventId);
    if (!slots) {
      slots = new Map<string, number>();
      this.slots.set(eventId, slots);
    }
    const existing = slots.get(sessionId);
    if (existing !== undefined) return existing;
    const taken = new Set(slots.values());
    let slot = 0;
    while (taken.has(slot)) slot++;
    slots.set(sessionId, slot);
    return slot;
  }

  private releaseSlot(eventId: string, sessionId: string): void {
    const slots = this.slots.get(eventId);
    if (!slots) return;
    slots.delete(sessionId);
    if (slots.size === 0) this.slots.delete(eventId);
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
        this.slots.delete(id);
        this.emit("ended", id);
      }
    }
  }
}
