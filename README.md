# PixelOffice

PixelOffice is a multiplayer virtual office inspired by Pokémon Emerald that helps
distributed teams feel present, connected, and aware of each other's availability
without becoming a surveillance tool. You open the office in your browser, spawn at
your department desk, walk around a pixel-art floor, and instantly see who is online,
who is available, who is in a meeting, and who is taking a coffee break. The true
product is **presence + meetings + social interaction + team awareness** — the map is
just the visualization layer. There is no keystroke logging, mouse tracking, screenshot
capture, or productivity scoring, ever.

---

## Quickstart

```bash
npm install          # installs all workspaces (shared, server, client)
npm run dev          # server on :2567, client on :5173
```

Then open **http://localhost:5173**. Pick a name, department, and avatar, and click
**Enter Office**.

To see multiplayer presence, **open http://localhost:5173 in two or more browser
windows** (or share your LAN IP with a teammate). Each window is a separate avatar;
move one with the arrow keys / WASD and watch it move in real time in the others.

> Low file-watcher limit? If `npm run dev` fails with `ENOSPC: System limit for number
> of file watchers reached`, either raise the limit
> (`sudo sysctl fs.inotify.max_user_watches=524288`) or run without watchers:
> `npm run start -w server` (server) and `CHOKIDAR_USEPOLLING=true npm run dev -w client`
> (client). For a no-watch client you can also `npm run build -w client && npm run preview -w client`.

---

## Feature Tour

- **Presence states & sources.** Every avatar carries one of six states —
  `AVAILABLE`, `IN_MEETING`, `FOCUS`, `BREAK`, `AWAY`, `OFFLINE` — each with a
  transparent *source* so the team knows where it came from: `CALENDAR` (an active
  meeting), `MANUAL` (you picked it), `EVENT` (you joined a coffee break), `AUTO`
  (idle timeout), or `SYSTEM` (default). Presence is resolved by a pure engine on
  the server and pushed to clients; the UI only displays it.
- **Status selector.** The top-bar pill opens a dropdown: Available / Focus / Break /
  Away. Picking one sends a manual override; picking **Available** clears the override
  and lets automatic rules take over again.
- **Auto-away.** If your session sees no activity for the configured timeout
  (`AWAY_TIMEOUT_MS`, default 90s) you flip to `AWAY` (source `AUTO`). Any action —
  moving, chatting, changing status — counts as activity and brings you back.
- **Chat.** The bottom-left input sends a short message that pops as a speech bubble
  over your avatar for everyone nearby and as a toast.
- **Coffee breaks & social events (via Admin).** An admin creates a Coffee Break, Tea
  Break, Team Gathering, or Town Hall. Everyone gets a toast and an entry in the
  "Happening now" panel with a **Join** button. Joining walks your avatar to the event
  area (Coffee Area / Lounge / Reception) and sets you to `BREAK`.
- **Meetings + the Join button (human-agency rule).** When a scheduled meeting starts,
  invited users get a toast and a persistent **Join Meeting** button. Your avatar is
  **never** teleported automatically — only clicking Join seats you in the assigned
  meeting room. Room size is chosen by invitee count (≤4 → Room A, ≤8 → Room B,
  else Room C).
- **Admin console.** The ⚙ Admin button opens a modal (plain REST calls) with tabs to
  create events, schedule meetings, send broadcasts, and view the live roster of
  connected users with their presence and current area.

---

## Architecture Overview

PixelOffice follows the layered constitution in `plan.md`. Business logic lives only in
framework-free services; Phaser and the DOM HUD are pure rendering/presentation layers.

| Layer (plan.md) | Responsibility | Where it lives |
|---|---|---|
| **World layer** | Rendering, avatars, grid movement, animations | `client/src/game/` (Phaser 3) |
| **Presence layer** | Availability/meeting/social state, presence calculation | `server/src/presence/` (pure engine + service) |
| **Integration layer** | Calendar (adapter pattern, independently removable) | `server/src/integrations/calendar/` |
| **Persistence layer** | User/session storage (in-memory for the MVP) | `server/src/repositories/` |
| **Transport / protocol** | Wire messages, office map, domain types (source of truth) | `shared/src/` |
| **Realtime room** | The only Colyseus-aware module: protocol handling, ticks | `server/src/rooms/office.room.ts` |
| **Admin REST** | `/api/health`, `/users`, `/events`, `/broadcast`, `/meetings` | `server/src/http/admin.routes.ts` |
| **Client shell / HUD** | Login, roster, status, events, chat, toasts, admin | `client/src/ui/`, `client/src/main.ts` |
| **Net wrapper** | Thin colyseus.js transport (no business logic) | `client/src/net/connection.ts` |

Key boundaries that are enforced:

- `shared/` is the single source of truth for the wire protocol (`protocol.ts`), the
  office map and collision (`map.ts`), and domain types (`types.ts`). Both sides import
  from `@pixeloffice/shared`; nothing is duplicated.
- The Phaser game contains **no** presence/meeting/network logic — it renders what the
  UI bridge (`client/src/main.ts`) tells it through the `OfficeGameHandle` contract.
- The server room is the only place that reads the clock; all services receive `now`
  injected from its tick, and dependencies are wired by hand in `server/src/container.ts`.
- Coordinates on the wire are **tile** coordinates (integers); the client converts to
  pixels for rendering.
- Presence is resolved server-side by a **pure** function (`presence-engine.ts`) with the
  priority order: meeting > manual focus > active event > manual break > manual away >
  auto-away > available.

---

## Tests & Smoke

```bash
npm test             # vitest: presence-engine state-transition tests (server)
```

```bash
# End-to-end protocol smoke test (needs a running server):
npm run dev          # in one terminal (or: npm run start -w server)
npm run smoke        # in another — joins the room and exercises the wire protocol
```

The smoke test joins two clients and asserts the full happy path: `WELCOME` with a
walkable spawn → move echo → second player join/move propagation → set-status →
presence change → create event via REST → `EVENT_CREATED` received → join event →
teleport to a Coffee Area anchor + `BREAK`/`EVENT` presence → schedule meeting via REST
→ `MEETING_STARTED`. It prints PASS/FAIL per step and exits non-zero on any failure.

To build the client for production:

```bash
npm run build -w client
```

---

## MVP Scope & Production Path

This is an honest MVP. The architecture was deliberately shaped so each stub swaps for a
real implementation behind an existing interface — no rewrites:

- **Auth.** Dev login is an OAuth stand-in behind the `AuthProvider` interface
  (`server/src/auth/`). The plan forbids custom username/password auth. Production drops
  in **Google / Microsoft OAuth** implementations of the same interface; the login card
  becomes the OAuth button.
- **Persistence.** Users/sessions live in `InMemoryUserRepository` behind the
  `UserRepository` interface. Production swaps in **PostgreSQL** (users, events) and
  **Redis** (presence, sessions) implementations — the room and services don't change.
- **Calendar.** A `MockCalendarAdapter` implements the `CalendarAdapter` interface
  (`getCurrentMeeting`, `getUpcomingMeetings`). Production adds a **Google Calendar
  adapter** (then Microsoft 365); the office keeps working if the integration fails
  (integrations are optional by design).
- **Backend framework.** Express + a hand-rolled DI container can be **ported to NestJS**
  (the plan's target) by moving the same services into Nest modules/providers; the
  Colyseus room and pure engine are framework-independent and carry over unchanged.
- **Security.** Add **JWT** sessions and **role-based access control** in front of the
  admin REST API (currently an unauthenticated dev console), and serve over **HTTPS**.
- **Ops.** Add **Docker / Docker Compose** (server, client, Postgres, Redis) and a
  **GitHub Actions** CI pipeline running `npm test`, the smoke test against a booted
  server, and `npm run build -w client`.
- **Integrations not yet built.** A **GreytHR adapter** (employee lookup, department
  sync, *explicit* attendance actions only — never auto check-in/out) follows the same
  adapter pattern.

The non-negotiables hold in this MVP and must continue to: presence not surveillance,
human agency (Join is always an explicit click), optional integrations, and business
logic that never leaks into Phaser scenes or UI components.
