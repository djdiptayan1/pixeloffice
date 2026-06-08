# 8-Ball Pool — Client/Server Contract

Server-authoritative 8-ball pool, wired into the EXISTING lounge-game protocol
(`JOIN_GAME` / `LEAVE_GAME` / `GAME_INPUT` ⇄ `GAME_UPDATE`). The client renders
and sends shots; ALL physics, rules, turn logic and the AI live server-side in
`server/src/games/pool/**` (framework-free, deterministic). This document is the
interface the client builder must code against.

---

## 1. Game id, type, station

- **Game id:** `"lounge:pool"` (registered in `OfficeRoom.onCreate`, like
  `"lounge:ping-pong"`).
- **`ActiveGame.type`:** `"pool"` (new member of `GameType`).
- **Furniture / station:** a new `FurnitureKind` `"pool-table"` placed in the
  Ground-floor **Lounge** at tile `x:43, y:21, w:3, h:2` (solid). The tiles all
  around it stay walkable. Wire the interact prompt EXACTLY like the existing
  ping-pong station in `client/src/game/scene.ts → checkGameProximity()`:

  ```ts
  // inside the floorId === "ground" block:
  // Pool table footprint x:43..45, y:21..22 → prompt on the surrounding ring.
  if (x >= 42 && x <= 46 && y >= 20 && y <= 23) {
    this.currentPromptGameId = "lounge:pool";
    this.cb.onInteractPrompt("Press [E] to play Pool", this.currentPromptGameId);
    return;
  }
  ```

  Pressing **E** emits `"lounge-game-interact"` with `"lounge:pool"` (no scene
  change needed — the existing bridge already routes that into the overlay).

---

## 2. Joining: SOLO vs AI and GROUP

`JoinGamePayload` gained an OPTIONAL `mode` field (backward-compatible):

```ts
interface JoinGamePayload {
  gameId: string;
  mode?: "ai" | "group"; // pool only; ignored by other games / non-seat-1 joiners
}
```

Send `C2S.JOIN_GAME` as today, adding `mode` for pool:

- **Solo vs AI:** first joiner sends `{ gameId: "lounge:pool", mode: "ai" }`.
  - Seat 1 = the human, seat 2 = the server AI (a synthetic `GamePlayer` with
    `sessionId === "AI"`, name `"Pool Bot"`). `ActiveGame.vsAi === true`.
  - `status` goes straight to `"playing"`; the human (player1) breaks.
- **Group (two humans):** first joiner sends `{ gameId: "lounge:pool", mode: "group" }`
  (or omits `mode`).
  - Seat 1 taken, `status: "waiting"`. A second human's `JOIN_GAME` takes seat 2,
    `status: "playing"`, player1 breaks. `vsAi` is `false`.
- **Spectators:** anyone who joins a pool table that is already full / mid-game
  becomes a spectator — they receive `GAME_UPDATE` broadcasts but hold no seat.
  The server simply re-sends them the current `game` on their join. Spectators’
  `GAME_INPUT` shots are ignored.

`POOL_AI_SESSION_ID` is exported from `@pixeloffice/shared` (`"AI"`). Compare
turns/winner against it to detect AI moves.

Leaving (`C2S.LEAVE_GAME`) or disconnecting:
- Solo: the table resets to `idle` (AI seat dropped, state cleared, station free).
- Group mid-game: the **remaining human wins by forfeit** (`status: "gameover"`,
  `winnerSessionId` = the stayer).
- A pending AI shot timer is always cancelled on leave.

---

## 3. The shot input (`GAME_INPUT`)

`GameInputPayload.input` for pool is a `PoolShotInput` (exported from shared):

```ts
interface PoolShotInput {
  angleRad: number;     // aim direction; 0 = +x (right), increasing CLOCKWISE toward +y (down)
  power: number;        // 0..1, clamped server-side; 1 = POOL_MAX_SHOT_SPEED
  cueX?: number;        // ball-in-hand re-spot (table units) — honored ONLY when state.ballInHand
  cueY?: number;        //   is true; ignored otherwise
}
```

Send only when it is **your** turn and the table is at rest:

```ts
callbacks.onGameInput("lounge:pool", { angleRad, power });
```

The server validates: it is the sender’s turn, they hold a seat, the table is
not mid-animation, and the numbers are finite. Out-of-turn / spectator / mid-shot
inputs are silently dropped. `power` is clamped to `[0,1]`. Shots are rate-limited
by the existing per-session **action** token bucket (10/sec).

**Ball-in-hand:** when `state.ballInHand` is `true`, the next shooter may include
`cueX,cueY` to re-spot the cue anywhere before aiming. If omitted while
ball-in-hand and the cue was pocketed, the server re-spots it to the head spot
(`x:50, y:50`).

---

## 4. Coordinate space (TABLE-LOCAL, fixed units = "tu")

All ball/pocket geometry is in table units, NOT pixels. Constants exported from
`@pixeloffice/shared`:

| Constant | Value | Meaning |
|---|---|---|
| `POOL_TABLE_W` | `200` | playfield width (inside cushions) |
| `POOL_TABLE_H` | `100` | playfield height (2:1 board) |
| `POOL_BALL_R` | `2.6` | ball radius |
| `POOL_POCKET_R` | `5.0` | pocket capture radius |
| `POOL_POCKETS` | 6 points | corners + 2 mid long-rail: `(0,0),(100,0),(200,0),(0,100),(100,100),(200,100)` |

- Origin `(0,0)` = top-left inside corner. **+x → right, +y → down** (same screen
  convention as the rest of the app).
- The client picks a pixel scale `S` and draws `pxX = originPx + x*S`,
  `pxY = originPy + y*S`. A canvas of e.g. 600×300 → `S = 3`.
- A ball at rest sits at its `{x,y}`; a pocketed ball has `pocketed: true` (stop
  rendering it on the table, optionally show it in a "potted" tray).

---

## 5. The state payload the client renders (`GAME_UPDATE`)

`ActiveGame.state` for a pool game is a `PoolState` (exported from shared):

```ts
interface PoolBall {
  id: number;                 // 0 = cue, 1..7 solids, 8 = eight, 9..15 stripes
  kind: "cue" | "solid" | "stripe" | "eight";
  x: number; y: number;       // table units (rest position)
  vx: number; vy: number;     // velocity (0 at rest)
  pocketed: boolean;
}

interface PoolShotEvent {
  potted: number[];           // ball ids sunk this shot (pocket order)
  scratch: boolean;           // cue pocketed
  foul: boolean;
  firstContactId: number | null;
  winnerSessionId?: string | null; // set when the game ended on this shot
  reason: string;             // "potted" | "miss" | "foul" | "scratch" | "win" | "illegal-8-loss"
}

interface PoolState {
  balls: PoolBall[];
  currentTurn: string;        // a player's sessionId, or "AI"
  assignedGroups: Record<string, "solid" | "stripe">; // {} while table is OPEN
  ballInHand: boolean;        // next shooter may re-spot the cue
  lastEvent: PoolShotEvent | null;
  trajectory?: Array<Array<{ id: number; x: number; y: number; pocketed: boolean }>>;
  animating: boolean;         // true while the server resolves a shot (lock input)
}
```

### Animation

After each resolved shot the server sends ONE `GAME_UPDATE` carrying:
- `balls` = the **final rest positions**, and
- `trajectory` = an **ordered list of frames**, each frame = `[{id,x,y,pocketed}]`
  at successive simulation steps (downsampled). `trajectory[0]` is the pre-shot
  snapshot; the last frame equals the rest state.

Two rendering options (your choice):
1. **Replay** `trajectory` frame-by-frame (smooth rolling motion), then settle on
   `balls`. Recommended ~60fps; frames are ~every 2 sim steps.
2. **Snap** directly to `balls` (no animation) — also valid; the state is fully
   authoritative either way.

`trajectory` is transient/optional — treat it as the animation for the LAST shot
only; once replayed, ignore it. Always trust `balls` as the source of truth.

### Turn / spectator / win signalling

- **Whose turn:** `state.currentTurn`. Compare to `store.get().selfId` to know if
  it is the local player's turn; compare to `"AI"` to show "Pool Bot is aiming…".
  Enable shot input only when `currentTurn === selfId && !animating && a seat`.
- **Groups:** `assignedGroups[selfId]` is `"solid"` / `"stripe"` once assigned,
  else the table is **open** (`assignedGroups === {}`). Caption accordingly.
- **Ball-in-hand:** if `state.ballInHand` and it is your turn, let the user drag
  the cue ball to a legal spot and send `cueX/cueY` with the next shot.
- **Win/over:** `ActiveGame.status === "gameover"` and `winnerSessionId` set (may
  be `"AI"`). `state.lastEvent.reason` explains it (`"win"` /
  `"illegal-8-loss"`). Render the existing VICTORY/DEFEAT banner; `selfId ===
  winnerSessionId` ⇒ victory.

### Overlay wiring (mirrors the other games)

In `client/src/ui/games.ts`, add a `game.type === "pool"` branch:
- Title `"8-Ball Pool"`.
- Draw a `<canvas>`, scale `POOL_*` tu → px, paint rails/pockets/balls.
- On the local player's turn, capture aim (e.g. mouse angle from the cue ball) +
  power (drag / slider) and call `callbacks.onGameInput(game.id, { angleRad, power })`.
- Show a join chooser for an idle pool table: "Play vs Bot" → `onJoinGame` with
  `mode:"ai"`; "Play with a friend" → `mode:"group"`. (Extend `HudCallbacks` /
  the join bridge to forward `mode`.)

---

## 6. AI behaviour (server-side, informational)

- Solo only. On the AI's turn the server waits ~1.4s (so the human's shot can
  animate), computes a shot via `pickShot()`, simulates it, and broadcasts the
  resulting `GAME_UPDATE` (same shape as a human shot). The client just renders.
- Difficulty defaults to `medium` (env `POOL_AI_DIFFICULTY=easy|medium|hard`);
  harder = tighter aim. Deterministic given a seed (no clock/Math.random in the
  engine).

---

## 7. Backward compatibility

- All new shared symbols are additive. Older clients ignore `mode`, `vsAi`,
  `pool` state, and the `pool-table` furniture (renders as an unknown/sprite
  fallback). No existing message shape changed.
- `buildOfficeMap()` gained one furniture entry (the pool table); the collision
  grid changes only at the table footprint. Smoke + building tests stay green.
