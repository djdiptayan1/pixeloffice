# Multi-Floor Contract (Phase 1 → Phase 2)

This is the authoritative interface the FOUNDATION BUILDER (Phase 1) exposes to the
Phase-2 agents (Map Studio, UI redesign, game-floor rendering). Code against the
symbols documented here verbatim. Everything is additive and backward-compatible:
the legacy single-floor `buildOfficeMap()` and the whole existing protocol are
unchanged; `npm test` (282 passing) and `npm run smoke` stay green.

All coordinates are TILE coordinates. `solid[y][x] === true` means blocked.

---

## 1. Shared model — `@pixeloffice/shared` (`shared/src/building.ts`)

A **Floor is structurally a superset of `OfficeMap`** — every existing helper
(`areaAt`, `isWalkable`, `anchorFor`) accepts a `Floor` unchanged.

```ts
export type PortalKind = "elevator" | "stairs";

export interface Portal {
  x: number; y: number;          // the tile a player steps onto (on THIS floor)
  kind: PortalKind;
  toFloorId: string;             // destination floor id (must exist in the Building)
  toX: number; toY: number;      // destination tile (must be walkable)
  label?: string;
}

export interface Floor extends OfficeMap {  // OfficeMap = width,height,areas,desks,furniture,walls,solid,anchors,spawn
  id: string;                    // "ground" | "floor-1" | "floor-2"
  name: string;                  // "Ground Floor"
  index: number;                 // 0,1,2  (floors[] is sorted ascending by index)
  portals: Portal[];             // links OWNED by this floor (tiles a player steps on here)
}

export interface Building {
  id: string;
  name: string;
  floors: Floor[];               // ordered ascending by index
}
```

### Serialization (the Map-Studio save/load format)

```ts
export interface FloorJSON {     // identical field shape to Floor, all JSON-safe
  id, name, index, width, height,
  areas, desks, furniture, walls, solid, anchors, spawn, portals
}
export interface BuildingJSON { id: string; name: string; floors: FloorJSON[] }

export function serializeBuilding(b: Building): BuildingJSON;
export function parseBuilding(json: unknown): Building;   // validates; throws BuildingParseError

export interface BuildingValidationError { code: string; message: string; floorId?: string }
export class BuildingParseError extends Error { readonly errors: BuildingValidationError[] }
```

`parseBuilding` rejects (each pushes a typed `BuildingValidationError`):
- `NOT_OBJECT`, `BAD_ID`, `NO_FLOORS`
- `BAD_FLOOR_ID`, `DUP_FLOOR_ID`
- `BAD_DIMS` (width/height not positive integers)
- `BAD_GRID` (`solid` is not exactly `height × width`)
- `BAD_SPAWN` (off-grid or on a solid tile)
- `BAD_PORTAL_TILE` (portal off-grid)
- `PORTAL_TARGET_MISSING` (`toFloorId` not in the building)
- `PORTAL_TARGET_BLOCKED` (`toX,toY` off-grid or on a solid tile)

On success, floors are sorted by `index`. **This is exactly what `POST /api/maps`
validates** — Map Studio should `serializeBuilding` before saving.

### Seed + helpers

```ts
export function buildDefaultBuilding(): Building;   // cached; 3 floors
export function floorById(b: Building, id: string): Floor | null;
export function portalAt(floor: Floor, x: number, y: number): Portal | null;

export const GROUND_FLOOR_ID = "ground";
export const FLOOR_1_ID = "floor-1";
export const FLOOR_2_ID = "floor-2";
export const DEFAULT_BUILDING_ID = "default";
```

`buildDefaultBuilding()` seeds three floors:
- **floors[0] "Ground Floor" (index 0)** — the EXACT current `buildOfficeMap()`
  layout (deep-cloned), PLUS one elevator portal near reception at tile `(44,31)`
  going up to `floor-1`. **This Ground floor is a placeholder the user redraws in
  Map Studio.** A new `FurnitureKind` `"elevator"` (non-solid marker) was added
  to render portal tiles.
- **floors[1] "Floor 1" (index 1)** and **floors[2] "Floor 2" (index 2)** — fresh
  48×34 layouts. Each has **four corner cabins** (7×6 rooms with a door, a table +
  whiteboard, named `Cabin NW/NE/SW/SE`, each with walkable anchors), a central
  department desk cluster (a `"<Floor> Floor"` DEPARTMENT area with 8 desks), a
  small Coffee Area nook, and an elevator lobby near tile `(23–25, 27)`. Floor 1
  links **down → ground** and **up → floor-2**; Floor 2 links **down → floor-1**
  only (top floor, no upward portal).

`buildOfficeMap()` (in `map.ts`) is UNCHANGED and still returns the single ground
`OfficeMap`; `buildDefaultBuilding().floors[0]` is derived from it verbatim.

---

## 2. Protocol changes — `@pixeloffice/shared` (`shared/src/protocol.ts`)

### `PlayerSnapshot` gains `floorId` (`shared/src/types.ts`)

```ts
interface PlayerSnapshot { /* ...existing... */ floorId?: string }
```

- **Migration:** the SERVER ALWAYS sets `floorId` on every snapshot it emits.
  It is typed OPTIONAL only so pre-multifloor literals/fixtures still compile.
  **Consumers must treat an absent `floorId` as `"ground"`.**

### WELCOME now carries the building + floor list

```ts
export interface FloorSummary  { id: string; name: string; index: number }
export interface BuildingSummary { id: string; name: string; floors: FloorSummary[] }

export interface WelcomePayload {
  self: PlayerSnapshot;          // self.floorId = the player's current floor
  players: PlayerSnapshot[];     // ONLY players on self's floor (floor-scoped)
  events: SocialEvent[];         // events on self's floor
  meeting: MeetingInfo | null;
  building?: BuildingSummary;    // NEW: floor picker source (optional/back-compat)
}
```

- **How the client learns the active building + floor list:** `welcome.building`
  (id/name/index per floor).
- **How the client learns its current floor:** `welcome.self.floorId`.
- **Full floor geometry** (areas/solid/desks/portals to render) is fetched from
  `GET /api/maps/active` (section 4). WELCOME deliberately carries only the
  lightweight floor list, not geometry.

### New S2C message: `FLOOR_CHANGED`

```ts
S2C.FLOOR_CHANGED = "floor-changed";

export interface FloorChangedPayload {
  selfFloorId: string;           // the player's NEW floor id (== self.floorId going forward)
  x: number; y: number; dir: Direction;   // new position on the destination floor
  players: PlayerSnapshot[];     // ALL other players on the destination floor
  events: SocialEvent[];         // active events on the destination floor
}
```

- **Sent ONLY to the player who changed floors**, after their own avatar stepped
  onto a portal tile. The client should tear down its current floor view and
  rebuild from this payload (fetch the new floor's geometry by `selfFloorId` from
  the building it already has, or `GET /api/maps/active`).

### How a floor change is TRIGGERED and SIGNALED (human agency)

- **Trigger:** the player walks their OWN avatar onto a portal tile. The client
  sends `C2S.MOVE` as usual — **no new C2S message is needed.** When the server
  validates a MOVE that lands on `portalAt(floor, x, y)`, it performs the change.
  Nothing auto-moves a player; only their own committed step does.
- **Signal sequence the server emits:**
  1. final `PLAYER_MOVED` to the OLD floor (avatar reaches the portal tile),
  2. `PLAYER_LEFT { sessionId }` to the OLD floor's other occupants,
  3. `PLAYER_JOINED { player }` (with the new `floorId`/position) to the NEW
     floor's other occupants,
  4. `FLOOR_CHANGED` to the mover.

### Floor-scoping of existing broadcasts (server already does this)

The server now sends these **only to clients on the same floor** as the subject:
`PLAYER_MOVED`, `PLAYER_JOINED`, `PLAYER_LEFT`, `PLAYER_TELEPORTED`, `PRESENCE`,
`CHAT`, `EMOTE`, `PLAYER_UPDATED`, `EVENT_CREATED`/`EVENT_UPDATED`/`EVENT_ENDED`,
and their TOAST. A client therefore only ever hears about co-located players.

**Meetings & events are per-floor.** An event/meeting belongs to the floor it was
created on; admin-REST-created events/meetings (no floor field) default to the
**ground floor** — preserving the legacy single-floor smoke/test behavior. A
player joins a meeting/event seated on its floor's map (meeting-room anchors fall
back to the ground floor if the player's floor lacks that room).

**Exception:** `GAME_UPDATE` (lounge games: ping-pong / tic-tac-toe / connect-four)
is still broadcast globally. Lounge games physically live only on the ground floor
and are already keyed by `gameId`, so a non-ground client harmlessly ignores them.
`MEETING_STARTED` / `MEETING_ENDED` remain participant-targeted (calendar-driven).

---

## 3. Server map repository — `server/src/maps/map-repository.ts`

```ts
export interface MapRecord { id: string; name: string; active: boolean }

export interface MapRepository {
  listMaps(): MapRecord[];
  getMap(id: string): BuildingJSON | null;
  saveMap(json: unknown): Building;       // validates via parseBuilding; throws BuildingParseError
  setActive(id: string): boolean;         // false if id unknown
  getActiveBuilding(): Building;           // fresh, validated, non-aliased instance
  getActiveId(): string;
}

export class InMemoryMapRepository implements MapRepository { /* seeded with buildDefaultBuilding() as active */ }
```

- Exposed on the DI container as **`container.maps`**.
- The room reads `container.maps.getActiveBuilding()` ONCE at create.
- **Changing the active map applies to NEW joins / new rooms only** — live players
  keep their current session/building/floor. (Documented simple behavior.)

---

## 4. REST — `/api/maps` (`server/src/http/maps.routes.ts`, mounted in `index.ts`)

| Method & path                | Auth                | Behavior |
|------------------------------|---------------------|----------|
| `GET /api/maps`              | open                | `{ maps: MapRecord[], activeId }` |
| `GET /api/maps/active`       | open                | `{ building: BuildingJSON }` (active) |
| `GET /api/maps/:id`          | open                | `{ building: BuildingJSON }` or 404 |
| `POST /api/maps`             | admin-guarded write | body = BuildingJSON → validate+save. 201 `{id,name,floors:[{id,name,index}]}`; **400 `{error, details: BuildingValidationError[]}`** on bad geometry |
| `POST /api/maps/:id/activate`| admin-guarded write | 200 `{ ok, activeId }` or 404 |

- Writes use the SAME `createAdminGuard(jwt, authRequired)` pattern as
  `admin.routes.ts`: a no-op in dev, `requireRole('admin')` when `AUTH_REQUIRED=true`.
- **Map Studio flow:** `GET /api/maps/active` to load → edit → `serializeBuilding`
  → `POST /api/maps` (handle 400 `details`) → `POST /api/maps/:id/activate`.

---

## 5. What Phase-2 agents must do

- **Map Studio:** edit a `Building`/`BuildingJSON`; save/activate via `/api/maps`;
  surface `400.details` validation errors; new floors must satisfy `parseBuilding`
  (correct grid dims, walkable spawn, portals targeting existing floors landing on
  walkable tiles). Render the `"elevator"` furniture marker on portal tiles.
- **Game floor rendering:** render the floor whose id is `self.floorId`; fetch
  geometry from `GET /api/maps/active` (or `/api/maps/:id`); on `FLOOR_CHANGED`,
  rebuild the scene from the payload (`selfFloorId`, position, `players`, `events`).
  Portals are plain tiles — stepping onto one is a normal MOVE; the server triggers
  the change. Do NOT auto-walk avatars (agency).
- **UI redesign:** render a floor indicator/picker from `welcome.building.floors`
  (display only — the picker must NOT teleport; floor changes happen by walking
  into an elevator). Roster/area readouts are already floor-scoped by the server.
```
