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
//
// Everything env-driven is OPT-IN. With NO env vars set the container resolves
// to the exact zero-config MVP behavior: dev auth, in-memory user repo,
// in-memory presence store, mock calendar, mock GreytHR. Real auth providers /
// JWT / Postgres / Redis / GreytHR activate only when their env config is
// present, and a configured-but-unreachable datastore degrades to in-memory
// instead of crashing (plan Principle 4: integrations are optional).
// ---------------------------------------------------------------------------

import { DevAuthProvider, type AuthProvider } from "./auth/auth-provider";
import { buildAuthConfig, type AuthConfig } from "./auth/auth-config";
import { JwtAuthProvider } from "./auth/jwt-auth.provider";
import {
  InMemoryUserRepository,
  type UserRepository,
} from "./repositories/user.repository";
import { MockCalendarAdapter } from "./integrations/calendar/mock-calendar.adapter";
import type { CalendarAdapter } from "./integrations/calendar/calendar-adapter";
import { GoogleCalendarAdapter } from "./integrations/calendar/google-calendar.adapter";
import { CompositeCalendarAdapter } from "./integrations/calendar/composite-calendar.adapter";
import {
  InMemoryGoogleTokenStore,
  type GoogleTokenStore,
} from "./auth/google-token.store";
import { EventService } from "./events/event.service";
import { PresenceService } from "./presence/presence.service";
import type { HrAdapter } from "./integrations/hr/hr-adapter";
import { GreytHrEssAttendanceAdapter } from "./integrations/hr/greythr-ess-attendance.adapter";
import { AttendanceService } from "./integrations/hr/attendance.service";
import { HttpGreytHrEssClient } from "./integrations/greythr/greythr-ess.client";
import { GreytHrAuthService } from "./auth/greythr/greythr-auth.service";
import {
  InMemoryGreytHrSessionStore,
  type GreytHrSessionStore,
} from "./auth/greythr/greythr-session.store";
import { buildGreytHrLoginConfig } from "./auth/greythr/greythr-auth.config";
import {
  createUserRepository,
  createPresenceStore,
} from "./persistence/factories";
import {
  InMemoryPresenceStore,
  type PresenceStore,
} from "./persistence/presence-store";
import type { Database } from "./persistence/database";
import type { RedisStore } from "./persistence/redis";
import { buildOfficeMap } from "@pixeloffice/shared";
import { NpcService, mulberry32, npcConfigFromEnv } from "./npcs/npc.service";
import type { OfficeRoom } from "./rooms/office.room";

// --- Synchronous, framework-free services (shared by REST + room) ----------
const mockCalendar = new MockCalendarAdapter();

// --- Google Calendar: real adapter only when OAuth creds are present --------
// Mirrors the GreytHR env-gate. When GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET are
// set, we construct a per-user refresh-token store + GoogleCalendarAdapter and
// OVERLAY it on the mock via a dumb CompositeCalendarAdapter (admin-scheduled
// dev meetings still work AND real Google meetings drive presence). With no env
// the calendar stays the pure mock — the zero-config path is untouched.
//
// Endpoint bases are env-overridable so a local stub can stand in for Google.
const googleCalConfigured =
  Boolean(process.env.GOOGLE_CLIENT_ID?.trim()) &&
  Boolean(process.env.GOOGLE_CLIENT_SECRET?.trim());

const googleTokenStore: GoogleTokenStore = new InMemoryGoogleTokenStore();

const googleCalendar: GoogleCalendarAdapter | null = googleCalConfigured
  ? new GoogleCalendarAdapter(
      {
        clientId: process.env.GOOGLE_CLIENT_ID!.trim(),
        clientSecret: process.env.GOOGLE_CLIENT_SECRET!.trim(),
        tokenBase: process.env.GOOGLE_TOKEN_BASE,
        apiBase: process.env.GOOGLE_API_BASE,
        pollIntervalMs: Number(process.env.GOOGLE_CAL_POLL_MS) || undefined,
        // GOOGLE_CAL_TITLES=false => read busy/free only, display "Busy".
        includeTitles: process.env.GOOGLE_CAL_TITLES !== "false",
      },
      googleTokenStore,
    )
  : null;

const calendar: CalendarAdapter = googleCalendar
  ? new CompositeCalendarAdapter(googleCalendar, mockCalendar)
  : mockCalendar;
const events = new EventService();
const presence = new PresenceService(calendar, events);

// --- Ambient NPCs (so the office never feels empty) ------------------------
// Framework-free behavior engine. Owns a seeded PRNG (NPC_SEED, default 42) so
// behavior is deterministic/testable; never reads the global clock or random.
// NPC_COUNT (default 8, 0 disables, clamped to 16). The room calls spawnAll()
// at create and tick() on its clock interval; effects become wire broadcasts.
const npcConfig = npcConfigFromEnv(process.env);
const npcs = new NpcService(
  buildOfficeMap(),
  mulberry32(npcConfig.seed),
  npcConfig.count,
);

// Auth provider (JWT in front of dev). greytHR is the single source of truth:
// when greytHR login is enabled it is the only way in, so a valid token is
// required to join — no anonymous/dev entry.
const authConfig: AuthConfig = buildAuthConfig(process.env);
if (process.env.GREYTHR_LOGIN_ENABLED === "true")
  authConfig.authRequired = true;
const devAuth = new DevAuthProvider();
const auth: AuthProvider = new JwtAuthProvider({
  jwt: authConfig.jwt,
  fallback: devAuth,
  authRequired: authConfig.authRequired,
  defaultDepartment: authConfig.defaultDepartment,
});

// --- greytHR ESS login (only when GREYTHR_LOGIN_ENABLED=true) ---------------
const greytHrLoginConfig = buildGreytHrLoginConfig(process.env);
// Read the repository through the live getter (it's set in initContainer).
const usersProxy: UserRepository = {
  save: (u) => container.users.save(u),
  findById: (id) => container.users.findById(id),
  all: () => container.users.all(),
};
// Shared greytHR session store: login writes, attendance reads.
const greytHrSessionStore: GreytHrSessionStore =
  new InMemoryGreytHrSessionStore();

const greytHrAuthService: GreytHrAuthService | null = greytHrLoginConfig
  ? new GreytHrAuthService({
      client: new HttpGreytHrEssClient({
        baseUrl: greytHrLoginConfig.baseUrl,
        timeoutMs: greytHrLoginConfig.timeoutMs,
      }),
      jwt: authConfig.jwt,
      users: usersProxy,
      adminEmails: authConfig.adminEmails,
      defaultDepartment: authConfig.defaultDepartment,
      allowedEmailDomains: authConfig.allowedEmailDomains,
      sessions: greytHrSessionStore,
    })
  : null;

// HR / GreytHR: all attendance goes through the self-hosted ESS API. No fallback
// — greytHR is the single source of truth.
const greytHrEssAttendanceConfigured = greytHrLoginConfig !== null;
const hr: HrAdapter = new GreytHrEssAttendanceAdapter({
  baseUrl:
    greytHrLoginConfig?.baseUrl ??
    (process.env.GREYTHR_CLIENT_URL?.trim().replace(/\/+$/, "") ||
      "http://localhost:3000"),
  sessions: greytHrSessionStore,
  timeoutMs: greytHrLoginConfig?.timeoutMs,
});
const attendance = new AttendanceService(hr);

const hrConfigured = greytHrEssAttendanceConfigured;

// "Open greytHR" deep link in the attendance widget (user-clicked, not a server call).
const DEFAULT_GREYTHR_PORTAL_URL = "https://kalvium.greythr.com";
const hrPortalUrl: string | undefined = hrConfigured
  ? process.env.GREYTHR_PORTAL_URL || DEFAULT_GREYTHR_PORTAL_URL
  : undefined;

// --- Persistence: defaults are in-memory; initContainer() may upgrade them --
let users: UserRepository = new InMemoryUserRepository();
let presenceStore: PresenceStore = new InMemoryPresenceStore();
let database: Database | null = null;
let redis: RedisStore | null = null;

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
  /** Per-user Google Calendar refresh-token store (connect flow + adapter). */
  googleTokenStore,
  /** Live Google Calendar adapter (background poll loop), or null when unconfigured. */
  googleCalendar,
  /** True when the real Google Calendar integration is active. */
  googleCalConfigured,
  events,
  presence,
  /** Ambient office NPCs (framework-free; the room wires effects to the wire). */
  npcs,
  auth,
  /** Auth config (providers map, jwt service, RBAC, AUTH_REQUIRED gate). */
  authConfig,
  /** greytHR ESS login service, or null when GREYTHR_LOGIN_ENABLED is not set. */
  greytHrAuth: greytHrAuthService,
  /** greytHR login config (null when disabled); carries the form subdomain. */
  greytHrLoginConfig,
  /** HR adapter + attendance service (mock unless GreytHR env is set). */
  hr,
  attendance,
  /** greytHR ESS portal deep link, or undefined when not configured. */
  hrPortalUrl,
  hrConfigured,
  greytHrSessionStore,
  registry,

  // Persistence — these getters return the live impls chosen by initContainer().
  get users(): UserRepository {
    return users;
  },
  get presenceStore(): PresenceStore {
    return presenceStore;
  },
  /** Non-null only when Postgres is the active user store (health/shutdown). */
  get database(): Database | null {
    return database;
  },
  /** Non-null only when Redis is the active presence store (health/shutdown). */
  get redis(): RedisStore | null {
    return redis;
  },
};

export type Container = typeof container;

let initialized = false;

/**
 * Resolve the env-driven persistence backends. Idempotent and safe to call
 * before `httpServer.listen()`. Selection + graceful fallback live in the
 * factories; a configured-but-down datastore degrades to in-memory and never
 * crashes boot. With no env vars this is effectively a no-op (stays in-memory).
 */
export async function initContainer(
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (initialized) return;
  initialized = true;

  // Start the Google Calendar background poll loop (no-op when unconfigured).
  // The adapter owns its own interval; the room tick stays untouched.
  googleCalendar?.start();

  const userResult = await createUserRepository(env);
  users = userResult.repository;
  database = userResult.database;

  const presenceStoreResult = await createPresenceStore(env);
  presenceStore = presenceStoreResult.store;
  redis = presenceStoreResult.redis;
}
