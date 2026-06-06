# PixelOffice — Module Contract

Source of truth for builder agents. `shared/` is ALREADY WRITTEN and is READ-ONLY —
import from `@pixeloffice/shared`, never redefine its types, and never edit it.
The wire protocol (message names + payloads) lives in `shared/src/protocol.ts`;
the office map (areas, collision, desks, anchors) lives in `shared/src/map.ts`.

## Runtime topology

- Server: Node 22, Colyseus 0.15 + Express on port **2567**.
  - WebSocket room name: `ROOM_NAME` (`"office"`) from shared protocol.
  - REST under `http://localhost:2567/api` (CORS enabled for the Vite origin).
- Client: Vite dev server on port **5173**, connects to `ws://localhost:2567`.
- Monorepo npm workspaces: `shared`, `server`, `client`. Root scripts already exist
  (`npm run dev` runs both via concurrently; `npm test` runs server tests).
- No external services: persistence is in-memory behind repository interfaces;
  calendar is a mock adapter behind `CalendarAdapter`; auth is a dev provider
  behind `AuthProvider` (OAuth slots in later — plan forbids username/password).

## Ownership (do not touch files outside your scope)

| Agent | Owns |
|---|---|
| server-builder | `server/**` |
| client-game-builder | `client/src/game/**` ONLY |
| client-ui-builder | `client/**` EXCEPT `client/src/game/**` (package.json, vite config, index.html, styles, main.ts, net/, ui/) |

## Colyseus usage (both sides)

- NO `@colyseus/schema` state sync. The room has no schema state; everything is
  plain JSON messages using the `C2S` / `S2C` constants and payload interfaces
  from `shared/src/protocol.ts`.
- Server: `colyseus` ^0.15 + `@colyseus/ws-transport` ^0.15. Client: `colyseus.js` ^0.15.
- Coordinates on the wire are TILE coordinates (integers), not pixels.

## Client internal boundary: game <-> UI

`client/src/game/index.ts` (owned by client-game-builder) MUST export exactly:

```ts
import type { Direction, PlayerSnapshot, PresenceState } from "@pixeloffice/shared";

export interface OfficeGameHandle {
  addPlayer(p: PlayerSnapshot): void;            // remote players only
  removePlayer(sessionId: string): void;
  movePlayer(sessionId: string, x: number, y: number, dir: Direction, moving: boolean): void;
  teleportPlayer(sessionId: string, x: number, y: number): void; // may target self
  setPresence(sessionId: string, state: PresenceState): void;    // also accepts self sessionId
  showChatBubble(sessionId: string, text: string): void;         // also accepts self sessionId
  destroy(): void;
}

export interface CreateGameOptions {
  parent: HTMLElement;
  self: PlayerSnapshot; // the game creates and controls the local avatar itself
  onLocalMove(x: number, y: number, dir: Direction, moving: boolean): void;
  onAreaChange?(areaName: string): void; // local player entered a named area ("Hallway" when none)
}

export function createOfficeGame(opts: CreateGameOptions): Promise<OfficeGameHandle>;
```

- The UI layer (owned by client-ui-builder) calls `createOfficeGame` after the
  WELCOME message, then bridges network messages <-> handle methods. It sends
  `C2S.MOVE` whenever `onLocalMove` fires.
- `teleportPlayer` with the self sessionId must snap the local avatar (cancel
  any in-flight step tween) — used after the user clicks Join on an event/meeting.
- The game layer NEVER talks to the network and contains NO business logic
  (no presence rules, no meeting rules) — it renders what it is told (plan rule).

## Server module layout (server-builder)

```
server/src/
  index.ts                        # express + colyseus boot, CORS, /api routes
  container.ts                    # manual DI: construct services once, share with room + routes
  auth/auth-provider.ts           # AuthProvider interface + DevAuthProvider (validates JoinOptions)
  repositories/user.repository.ts # UserRepository interface + InMemoryUserRepository
  presence/presence-engine.ts     # PURE function resolvePresence(input) -> { state, source }
  presence/presence-engine.test.ts# vitest: state-transition tests (the plan REQUIRES these)
  presence/presence.service.ts    # runtime presence records, EventEmitter: "change", "meeting-started", "meeting-ended"
  integrations/calendar/calendar-adapter.ts      # CalendarAdapter interface (getCurrentMeeting, getUpcomingMeetings)
  integrations/calendar/mock-calendar.adapter.ts # in-memory impl + createMeeting() used by admin REST
  events/event.service.ts         # social events: create/join/leave/expire, EventEmitter: "created","updated","ended"
  rooms/office.room.ts            # Colyseus room: protocol handling, desk spawn, move validation, ticks
  http/admin.routes.ts            # GET /api/users, POST /api/events, /api/broadcast, /api/meetings, GET /api/health
  scripts/smoke.ts                # joins the room via colyseus.js, exercises the protocol, exits 0/1
```

### Presence resolution (priority order — encode in the pure engine + tests)

1. not connected → `OFFLINE` (source SYSTEM)
2. active calendar meeting → `IN_MEETING` (CALENDAR) — highest, beats everything
3. manual `FOCUS` → `FOCUS` (MANUAL)
4. joined an active social event → `BREAK` (EVENT)
5. manual `BREAK` → `BREAK` (MANUAL)
6. manual `AWAY` → `AWAY` (MANUAL)
7. inactive ≥ `AWAY_TIMEOUT_MS` (env, default 90000) → `AWAY` (AUTO)
8. otherwise → `AVAILABLE` (SYSTEM)

Manual `AVAILABLE` clears the override. Any C2S message counts as activity
(clears auto-AWAY). Presence changes are broadcast as `S2C.PRESENCE`.

### Behavior rules (from plan.md — non-negotiable)

- Spawn: first free desk seat in the user's department (`map.desks`), else `map.spawn`.
- Meeting start: send `S2C.MEETING_STARTED` to participants only. Do NOT move avatars.
  Only `C2S.JOIN_MEETING` (user click) seats them at `anchorFor(map, meeting.roomName, i)`.
- Events: `POST /api/events` creates one (type ∈ SocialEventType, duration), broadcast
  `S2C.EVENT_CREATED` + a TOAST. `C2S.JOIN_EVENT` teleports the sender to
  `anchorFor(map, event.areaName, i)` and sets BREAK via the event source.
  When the event ends: `S2C.EVENT_ENDED`, presence recomputes.
- Meetings: `POST /api/meetings { title, startsInMinutes, durationMinutes, participantIds? }`
  (empty/omitted participants = everyone). Room assigned by invitee count:
  ≤4 → "Meeting Room A", ≤8 → "Meeting Room B", else "Meeting Room C".
  The presence tick (every ~3s) detects start/end via the CalendarAdapter.
- Move validation: reject if `!isWalkable(map, x, y)` or the step is > 1 tile from
  the last validated position (teleports excepted); then broadcast PLAYER_MOVED to others.
- No surveillance: track nothing beyond session activity timestamps + explicit status.

## Client UI layout (client-ui-builder)

```
client/
  package.json     # vite ^5, typescript ^5, phaser ^3.85, colyseus.js ^0.15, @pixeloffice/shared "*"
  vite.config.ts   # optimizeDeps.exclude ["@pixeloffice/shared"]; server.port 5173
  tsconfig.json
  index.html       # #app root; game canvas container + HUD overlay elements
  src/main.ts      # login -> connect -> createOfficeGame -> wire messages <-> handle/HUD
  src/net/connection.ts  # colyseus.js wrapper: connect(JoinOptions), typed send/on via C2S/S2C
  src/ui/login.ts  # name, department select (DEPARTMENTS), avatar swatches (AVATAR_IDS)
  src/ui/hud.ts    # status selector, sidebar roster, events panel, Join Meeting button, chat input
  src/ui/toasts.ts # toast notifications (events, meetings, broadcasts)
  src/ui/admin.ts  # modal: create event, schedule meeting, broadcast, online users (fetch /api)
  src/styles.css   # dark pixel-office aesthetic, monospace/pixel font, no Tailwind (keep deps lean)
```

- Status selector options: Available / Focus / Break / Away → `C2S.SET_STATUS`
  (Available clears override). Show state via `PRESENCE_META` colors/labels.
- Sidebar roster: every player (self first) with presence dot, name, department,
  and current area name (compute via `areaAt` from each player's tile position —
  display only, recomputed on PLAYER_MOVED/TELEPORTED).
- MEETING_STARTED → toast + persistent "Join Meeting: <title>" button (agency rule).
  Clicking sends `C2S.JOIN_MEETING`. Never auto-act.
- EVENT_CREATED → toast + entry in events panel with Join/Leave buttons.
- Admin modal is plain `fetch` to `http://localhost:2567/api/*`.
- Login screen blocks until joined; show errors (server down) gracefully.

## Definition of Done (workflow gate)

- `npm install && npm test` green (presence engine transitions covered).
- `npm run dev` boots both; `GET /api/health` returns ok.
- `npm run smoke` passes against a running server: join → welcome → move echo →
  set-status → presence change → create event via REST → event-created received →
  join-event → teleport + BREAK presence → meeting via REST → meeting-started.
- `npm run build -w client` succeeds (vite production build).
- No business logic in Phaser scenes or UI components; adapters isolated; agency rules hold.
