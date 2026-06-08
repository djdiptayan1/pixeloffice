# AGENTS.md — PixelOffice

The single source of truth for engineers **and** AI agents working in this repo.
Read this before touching code. For the product/user/operator view (features, env
matrix, screenshots, Docker), see [README.md](README.md).

> PixelOffice is a multiplayer virtual office (Pokémon Emerald vibe) focused on
> **presence, meetings, and social interaction — never surveillance.** The pixel map is
> only the visualization layer; the product is presence + meetings + social interaction
> + team awareness.

## Contents

- [The Constitution (non-negotiable)](#the-constitution-non-negotiable)
- [Engineering rules](#engineering-rules)
- [Repo layout](#repo-layout)
- [Module map](#module-map)
- [Wire protocol](#wire-protocol)
- [Presence engine](#presence-engine)
- [Build / test / run](#build--test--run)
- [Adding an integration behind an adapter](#adding-an-integration-behind-an-adapter)
- [Conventions for contributors & agents](#conventions-for-contributors--agents)

---

## The Constitution (non-negotiable)

These four principles override convenience, cleverness, and any feature request. If a
change would break one, it is wrong.

1. **Presence, not surveillance.** Allowed signals: calendar events, meeting
   participation, explicit status selection, session activity. **Forbidden:** keystroke
   logging, mouse tracking, screenshot capture, IDE spying, productivity scores,
   activity ranking, or any who-was-where-when history. Logs deliberately exclude chat
   content, movement, and per-user activity. Opt-in floor detection stores only the
   transient Office/Remote tag + current floor — never the IP, never a trace.
2. **Human agency.** The office never auto-moves or auto-acts for a user. Meetings and
   events surface a **Join** button; only the user's explicit click seats their avatar.
   Attendance check-in/out is explicit only — no timers, no auto check-in/out, no
   session-lifecycle hooks. Walking into an elevator (a committed step) and flipping the
   floor-sync toggle are the user's own consented actions.
3. **Integrations are optional.** If greytHR, Google Calendar, Microsoft 365, Postgres,
   or Redis fails or is unconfigured, **the office still works.** Every integration sits
   behind an adapter, is env-gated, and degrades to a mock / in-memory path with a
   warning. No integration is ever a hard dependency. **Never break the zero-config dev
   path** (`npm install && npm run dev` with no env set).
4. **OAuth-only identity, no passwords.** PixelOffice builds **no** custom
   username/password auth. Identity comes from external IdPs behind the `AuthProvider`
   interface (Google / Microsoft OAuth, or greytHR sign-in). The dev login is an
   explicit OAuth stand-in. For greytHR, the credential is forwarded once,
   server-to-server, to the ESS proxy; PixelOffice stores no passwords, only its minted
   JWT.

---

## Engineering rules

- **No business logic in React components or Phaser scenes.** The client renders
  server-pushed facts and forwards explicit user actions — nothing more.
- **Always use service layers.** Business logic is framework-independent and lives in
  plain TypeScript services.
- **Define interfaces before implementations.** (`AuthProvider`, `CalendarAdapter`,
  `HrAdapter`, `UserRepository`, `PresenceStore`, `MapRepository`, …)
- **Use dependency injection.** Construct every service once in `server/src/container.ts`
  and inject through constructors. No DI framework — explicit and readable.
- **Keep integrations isolated behind adapters.** Never call a third-party API from a UI
  component or a scene.
- **Always write tests for state transitions.** The presence engine, attendance state
  machine, auth/RBAC, and game rules carry exhaustive transition tests — trust in
  presence is the product.
- **Avoid premature optimization. Prefer maintainability over cleverness.**

---

## Repo layout

A monorepo with three npm workspaces:

- **`shared/`** — framework-free domain types (`types.ts`), the wire protocol
  (`protocol.ts`), the single-floor office map + collision (`map.ts`), and the
  multi-floor `Building`/`Floor` model + serialization (`building.ts`). The **single
  source of truth** both sides compile against (`@pixeloffice/shared`); never duplicate
  its types on either side.
- **`server/`** — Node 22 + Colyseus 0.15 + Express on port **2567**: a thin WebSocket
  room translating protocol messages to/from framework-free services that reach the
  outside world only through adapter interfaces.
- **`client/`** — Vite + TypeScript + Phaser 3: the rendering layer (`src/game/`) and a
  vanilla-TS DOM HUD (`src/ui/`), connected on `ws://localhost:2567` (dev server :5173).

Runtime topology: Colyseus room name `"office"` (`ROOM_NAME` in shared); REST under
`http://localhost:2567/api`; coordinates on the wire are **tile** coordinates (integers).
There is **no `@colyseus/schema` state sync** — everything is plain JSON messages.

---

## Module map

### Server (`server/src/`)

| Area | Files | Responsibility |
|---|---|---|
| Boot & DI | `index.ts`, `container.ts`, `load-env.ts` | Express + Colyseus boot, CORS, route mounting; `initContainer()` wires every service (env-gated selection + graceful fallback). |
| Realtime room | `rooms/office.room.ts`, `rooms/slot-allocator.ts` | The **only** Colyseus-aware module: protocol handling, desk spawn, move/portal validation, floor-scoped broadcasts, 3s tick, seating meeting/event joiners, NPC effects, lounge games. |
| Presence | `presence/presence-engine.ts` (pure), `presence/presence.service.ts` | Pure `resolvePresence(input)` + runtime presence records (EventEmitter: change / meeting-started / meeting-ended). |
| Social events | `events/event.service.ts` | Create/join/leave/expire coffee breaks & events (EventEmitter: created / updated / ended). |
| NPCs | `npcs/npc.service.ts` | Deterministic seeded simulation returning move/presence/chat **effects**; the room renders them as ordinary players. |
| Auth | `auth/auth-provider.ts`, `jwt*.ts`, `oauth-provider.ts`, `google-oauth.provider.ts`, `microsoft-oauth.provider.ts`, `oauth-state.ts`, `rbac.ts`, `middleware.ts`, `auth-config.ts`, `super-admins.ts`, `greythr/*` | `AuthProvider` + JWT/OAuth/greytHR providers; RBAC via `ADMIN_EMAILS`; `createAdminGuard` (no-op unless `AUTH_REQUIRED`). |
| Calendar | `integrations/calendar/{calendar-adapter,mock-calendar.adapter,google-calendar.adapter,composite-calendar.adapter}.ts`, `auth/google-token.store.ts` | `CalendarAdapter` interface; mock (admin-seeded) overlaid with real Google when configured. |
| HR / attendance | `integrations/hr/{hr-adapter,mock-greythr.adapter,greythr-ess-attendance.adapter,attendance.service}.ts`, `integrations/greythr/greythr-ess.client.ts` | `HrAdapter` interface; framework-free explicit-action attendance state machine; greytHR ESS client (single egress). |
| Location | `location/floor-location.adapter.ts` | Opt-in IP→Office/Remote+floor classification from `OFFICE_SUBNETS`/`OFFICE_CIDRS`. |
| Maps | `maps/map-repository.ts` | `MapRepository` (in-memory, seeded with `buildDefaultBuilding()`); active building for new joins. |
| Games | `games/pool/*` | Server-authoritative 8-ball pool (physics, rules, AI, deterministic PRNG); ping-pong / tic-tac-toe / connect-four live in the room. |
| Persistence | `persistence/{database,redis,presence-store,factories}.ts`, `repositories/{user.repository,postgres-user.repository}.ts`, `db/init.sql` | Postgres/Redis behind interfaces, in-memory defaults; factories select + fall back. |
| HTTP | `http/{admin,auth,hr,maps}.routes.ts`, `http/{rate-limit,static-client}.ts` | Admin/auth/hr/maps REST; token-bucket rate limit; `SERVE_CLIENT` static + SPA fallback. |
| Lifecycle | `lifecycle/shutdown.ts`, `logging/logger.ts` | Graceful SIGINT/SIGTERM drain; surveillance-free logger. |
| Scripts | `scripts/{smoke,calendar-smoke,google-stub}.ts` | Protocol smoke test; calendar smoke; local Google stub for offline E2E. |

The room is deliberately the only Colyseus-aware module: it owns the live
`PlayerSnapshot` map, reads the system clock (passing `now` down to pure services),
translates service events to broadcasts, and detaches its listeners on dispose
(services are singletons). All **decisions** live in the services.

### Client (`client/src/`)

| Area | Files | Responsibility |
|---|---|---|
| Composition root | `main.ts` | login → connect → `WELCOME` → boot game + HUD, then a message-type→handler bridge. Idempotent welcome bootstrapping makes reconnects clean (a fresh sessionId tears down and rebuilds). |
| Game (Phaser) | `game/{index,scene,textures,constants}.ts` | One scene; all textures generated at runtime on canvas (zero binary assets). Grid stepping; exposes the imperative `OfficeGameHandle`; calls back `onLocalMove` / `onAreaChange`. **No** presence/meeting/network logic. |
| Net | `net/connection.ts` | Thin colyseus.js wrapper: typed send/on via `C2S`/`S2C`, auto-reconnect with backoff, `onState`. No business logic. |
| HUD | `ui/{hud,login,toasts,admin,attendance,calendar-connect,connection-banner,emote-bar,games,minimap,onboarding,profile,profile-card,settings,map-studio,state}.ts` | Vanilla-TS components rendering from a tiny subscribe store; never computes presence. |

The game ↔ UI contract (`client/src/game/index.ts`):

```ts
export interface OfficeGameHandle {
  addPlayer(p: PlayerSnapshot): void;            // remote players only
  removePlayer(sessionId: string): void;
  movePlayer(sessionId: string, x, y, dir: Direction, moving: boolean): void;
  teleportPlayer(sessionId: string, x, y): void; // may target self (cancel in-flight step)
  setPresence(sessionId: string, state: PresenceState): void;
  showChatBubble(sessionId: string, text: string): void;
  destroy(): void;
}
export function createOfficeGame(opts: CreateGameOptions): Promise<OfficeGameHandle>;
```

The UI calls `createOfficeGame` after `WELCOME`, bridges network messages ↔ handle
methods, and sends `C2S.MOVE` whenever `onLocalMove` fires. The game never talks to the
network.

---

## Wire protocol

Declared once in `shared/src/protocol.ts` as `C2S` (client→server) and `S2C`
(server→client) string constants with typed payload interfaces. Tile coordinates only.

**C2S:** `MOVE`, `SET_STATUS`, `CHAT`, `EMOTE`, `JOIN_EVENT`, `LEAVE_EVENT`,
`JOIN_MEETING`, `LEAVE_MEETING`, `JOIN_GAME`, `LEAVE_GAME`, `GAME_INPUT`,
`UPDATE_PROFILE`, `SET_LOCATION_SYNC`.

**S2C:** `WELCOME`, `PLAYER_JOINED`, `PLAYER_LEFT`, `PLAYER_MOVED`,
`PLAYER_TELEPORTED`, `PLAYER_UPDATED`, `PRESENCE`, `CHAT`, `EMOTE`, `EVENT_CREATED`,
`EVENT_UPDATED`, `EVENT_ENDED`, `FLOOR_CHANGED`, `MEETING_STARTED`, `MEETING_ENDED`,
`TOAST`, `GAME_UPDATE`, `LOCATION`.

Key flows:

- **Join** → `AuthProvider` authenticates (`JoinOptions.token` is read defensively;
  dev path omits it) → server seats a free desk in the user's department on the spawn
  floor → `WELCOME` (self, floor-scoped players incl. NPCs, events, current meeting,
  building summary) → broadcasts `PLAYER_JOINED` to the same floor.
- **Move** → one `MOVE` per committed tile step; server validates walkable + ≤1-tile
  delta; an invalid move gets an authoritative `PLAYER_TELEPORTED` correction.
- **Floors** → stepping onto an elevator (portal) tile is a normal `MOVE`; the server
  detects the portal, runs the crossing, and sends `FLOOR_CHANGED` to the mover (plus
  `PLAYER_LEFT`/`PLAYER_JOINED` to the two floors). No new C2S message — nothing
  auto-moves a player.
- **Floor-scoping** → `PLAYER_*`, `PRESENCE`, `CHAT`, `EMOTE`, `EVENT_*`, `LOCATION`
  go only to clients on the same floor as the subject. `MEETING_STARTED`/`ENDED` are
  participant-targeted; `GAME_UPDATE` is global (keyed by `gameId`).
- **Meetings** → admin REST seeds the calendar adapter; the tick detects the window and
  sends `MEETING_STARTED` **to participants only**. Nothing moves until `JOIN_MEETING`.
- **Events** → `EVENT_CREATED` + toast; `JOIN_EVENT` teleports **the sender only** to an
  area anchor and sets `BREAK` via the `EVENT` source.
- **Games** → `JOIN_GAME` / `LEAVE_GAME` / `GAME_INPUT` drive server-authoritative game
  state rebroadcast as `GAME_UPDATE`. Stations: `lounge:pool`, `lounge:ping-pong`,
  `lounge:tic-tac-toe`, `lounge:connect-four`.
- **Floor sync** → `SET_LOCATION_SYNC { enabled }`; the server classifies the IP and
  replies with `LOCATION` (and, when Office + a different floor, a consented
  `FLOOR_CHANGED`). Opt-out clears the tag and never moves the avatar.

Geometry (areas/solid/desks/portals) is fetched from `GET /api/maps/active`, not carried
in `WELCOME` (which holds only the lightweight floor list). Abuse guards: per-session
token buckets on MOVE/CHAT/actions, payload validation on every handler, REST rate
limiting per IP (XFF only honored behind `TRUST_PROXY`).

---

## Presence engine

A single **pure** function (`presence/presence-engine.ts`) — no I/O, no clock reads; the
room is the only module that reads the clock and passes `now` down. Priority order:

1. not connected → `OFFLINE` (SYSTEM)
2. active calendar meeting → `IN_MEETING` (CALENDAR) — beats everything
3. manual Focus → `FOCUS` (MANUAL)
4. joined an active social event → `BREAK` (EVENT)
5. manual Break → `BREAK` (MANUAL)
6. manual Away → `AWAY` (MANUAL)
7. inactive ≥ `AWAY_TIMEOUT_MS` (default 90 s) → `AWAY` (AUTO)
8. otherwise → `AVAILABLE` (SYSTEM)

Manual Available clears the override; any C2S message counts as activity (clears
auto-AWAY). Every state carries its **source** so the UI is transparent about *why*.
Changes broadcast as `S2C.PRESENCE`. The engine has exhaustive transition tests.

---

## Build / test / run

```bash
npm install                  # root, installs all workspaces
npm run dev                  # server :2567 + client :5173 (concurrently)
npm test                     # vitest: server state-transition suite
npm run smoke                # E2E protocol smoke (needs a running server)
npm run build -w client      # vite production build
npm run google-stub          # local Google OAuth/Calendar stub for offline tests
```

Definition of done for a change: `npm test` green, `npm run dev` boots both,
`GET /api/health` ok, `npm run smoke` passes, `npm run build -w client` succeeds, no
business logic leaked into scenes/components, adapters isolated, agency rules hold.

---

## Adding an integration behind an adapter

1. **Define the interface** in the relevant `server/src/integrations/<area>/` (or
   `auth/`) directory — the seam, not the vendor.
2. **Implement** a vendor adapter (`fetch`-based, no SDK where avoidable) and a mock /
   in-memory default.
3. **Env-gate the selection** in `container.ts`: configured + reachable → real adapter;
   unset or unreachable → mock, with a warning. Never crash boot on a dead integration.
4. **Document the env vars** in `.env.example` and the README config table.
5. **Wrap every external call in try/catch at the adapter boundary** (Principle 3).
6. **Test** the mapping, the env gate, and graceful degradation. State machines get
   transition tests.
7. **Extend `shared/` only backward-compatibly** (additive, optional fields) so older
   clients and existing fixtures keep compiling and the smoke test stays green.

See `docs/google-workspace-integration.md` and `docs/ROADMAP-integrations.md` for
worked examples and the planned roadmap. The full env matrix lives in
[README.md](README.md#configuration).

---

## Conventions for contributors & agents

- **Never break zero-config dev.** `npm install && npm run dev` with no env set must run
  the full experience (dev login, in-memory, mocks, NPCs, open admin).
- **Keep `npm test` and `npm run smoke` green** on every change.
- **Extend `shared/` backward-compatibly** — additive optional fields only; the wire
  protocol is the contract between both sides.
- **No business logic in Phaser scenes or UI components**; keep integrations behind
  adapters; respect the human-agency and no-surveillance rules in every feature.
- **Commit author must be `Aryan Tuntune <115869835+aryantuntune@users.noreply.github.com>`.**
  Never commit as `anil@kalvium.com`. The canonical repo is `aryantuntune/pixeloffice`.
- **Don't add binary assets** — the client generates all textures at runtime on canvas.
