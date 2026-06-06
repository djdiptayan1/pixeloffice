// ---------------------------------------------------------------------------
// Manual dependency-injection container.
//
// Constructs every framework-independent service ONCE and shares the same
// instances with the Colyseus room and the Express admin routes. Services are
// constructor-injected with their dependencies (interfaces, never concretes
// from the room) — none of them import Colyseus.
//
// The `registry` holds a mutable reference to the live room so admin REST can
// broadcast through it; the room sets it in onCreate. This is the single seam
// where the otherwise framework-free services touch the room.
// ---------------------------------------------------------------------------

import { DevAuthProvider, type AuthProvider } from "./auth/auth-provider";
import { InMemoryUserRepository, type UserRepository } from "./repositories/user.repository";
import { MockCalendarAdapter } from "./integrations/calendar/mock-calendar.adapter";
import type { CalendarAdapter } from "./integrations/calendar/calendar-adapter";
import { EventService } from "./events/event.service";
import { PresenceService } from "./presence/presence.service";
import type { OfficeRoom } from "./rooms/office.room";

// Concrete instances kept here so REST + room share state (events, calendar).
const mockCalendar = new MockCalendarAdapter();
const calendar: CalendarAdapter = mockCalendar;
const events = new EventService();
const presence = new PresenceService(calendar, events);
const users: UserRepository = new InMemoryUserRepository();
const auth: AuthProvider = new DevAuthProvider();

/** Live-room registry. Set by OfficeRoom.onCreate; read by admin routes. */
export interface RoomRegistry {
  room: OfficeRoom | null;
}
const registry: RoomRegistry = { room: null };

export const container = {
  /** Concrete mock adapter — admin REST needs `createMeeting`. */
  mockCalendar,
  /** Interface view of the calendar (what services depend on). */
  calendar,
  events,
  presence,
  users,
  auth,
  registry,
};

export type Container = typeof container;
