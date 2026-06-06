// ---------------------------------------------------------------------------
// End-to-end protocol smoke test. Assumes the server is ALREADY running on
// localhost:2567 (npm run dev). Exercises the wire protocol with colyseus.js,
// prints PASS/FAIL per step, exits 1 on any failure, hard timeout 30s.
//
// No test framework — just small waitFor() promises against received messages.
// ---------------------------------------------------------------------------

import { Client, type Room } from "colyseus.js";
import {
  C2S,
  DEFAULT_SERVER_PORT,
  PresenceState,
  ROOM_NAME,
  S2C,
  buildOfficeMap,
  isWalkable,
  type Direction,
  type JoinOptions,
  type MovePayload,
  type PlayerJoinedPayload,
  type PlayerMovedPayload,
  type PlayerTeleportedPayload,
  type PresencePayload,
  type SetStatusPayload,
  type WelcomePayload,
} from "@pixeloffice/shared";

const ENDPOINT = `ws://localhost:${DEFAULT_SERVER_PORT}`;
const HTTP = `http://localhost:${DEFAULT_SERVER_PORT}`;
const HARD_TIMEOUT_MS = 30_000;

let failures = 0;

function pass(step: string): void {
  console.log(`PASS  ${step}`);
}
function fail(step: string, detail?: string): void {
  failures++;
  console.log(`FAIL  ${step}${detail ? ` — ${detail}` : ""}`);
}

/** Resolve when `predicate` returns truthy, else reject after `timeoutMs`. */
function waitFor<T>(
  describe: string,
  poll: () => T | undefined,
  timeoutMs = 7000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      const v = poll();
      if (v !== undefined && v !== null && v !== false) {
        resolve(v as T);
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`timeout waiting for ${describe}`));
        return;
      }
      setTimeout(tick, 50);
    };
    tick();
  });
}

/** Capture messages of a given type into a growing array. */
function collector<T>(room: Room, type: string): T[] {
  const bucket: T[] = [];
  room.onMessage(type, (msg: T) => bucket.push(msg));
  return bucket;
}

async function main(): Promise<void> {
  const map = buildOfficeMap();
  const client = new Client(ENDPOINT);

  const optsA: JoinOptions = { name: "Smoke", department: "Engineering", avatarId: "emerald" };
  const roomA: Room = await client.joinOrCreate(ROOM_NAME, optsA);

  // Set up collectors before sending anything.
  const welcomesA = collector<WelcomePayload>(roomA, S2C.WELCOME);
  const presenceA = collector<PresencePayload>(roomA, S2C.PRESENCE);
  const teleportsA = collector<PlayerTeleportedPayload>(roomA, S2C.PLAYER_TELEPORTED);
  const eventsCreatedA = collector<{ event: { id: string } }>(roomA, S2C.EVENT_CREATED);
  const meetingsStartedA = collector<{ meeting: { id: string; title: string } }>(
    roomA,
    S2C.MEETING_STARTED,
  );

  // 1. WELCOME with self at a walkable tile.
  const welcome = await waitFor("WELCOME", () => welcomesA[0]);
  if (
    welcome.self &&
    Number.isInteger(welcome.self.x) &&
    Number.isInteger(welcome.self.y) &&
    isWalkable(map, welcome.self.x, welcome.self.y)
  ) {
    pass(`WELCOME self spawn at (${welcome.self.x},${welcome.self.y})`);
  } else {
    fail("WELCOME self spawn at walkable tile", JSON.stringify(welcome.self));
  }

  const self = welcome.self;

  // 2. MOVE one tile in a walkable direction.
  const firstStep = pickWalkableStep(map, self.x, self.y);
  if (!firstStep) {
    fail("find a walkable adjacent tile for first MOVE");
  } else {
    roomA.send(C2S.MOVE, firstStep);
    pass(`MOVE to (${firstStep.x},${firstStep.y})`);
  }

  // 3. Second client joins; roomA must receive PLAYER_JOINED, then PLAYER_MOVED
  //    when client A moves again.
  // Register the collector BEFORE B joins, or the broadcast races past us.
  const joinedA = collector<PlayerJoinedPayload>(roomA, S2C.PLAYER_JOINED);

  const clientB = new Client(ENDPOINT);
  const optsB: JoinOptions = { name: "Buddy", department: "Product", avatarId: "ruby" };
  const roomB: Room = await clientB.joinOrCreate(ROOM_NAME, optsB);

  const movedB = collector<PlayerMovedPayload>(roomB, S2C.PLAYER_MOVED);

  try {
    await waitFor("PLAYER_JOINED (B seen by A)", () =>
      joinedA.find((m) => m.player.name === "Buddy"),
    );
    pass("PLAYER_JOINED received by A");
  } catch (e) {
    fail("PLAYER_JOINED received by A", (e as Error).message);
  }

  // A moves again -> B should receive PLAYER_MOVED.
  const cur = firstStep ?? { x: self.x, y: self.y, dir: "down" as Direction, moving: false };
  const secondStep = pickWalkableStep(map, cur.x, cur.y, cur.dir);
  if (secondStep) {
    roomA.send(C2S.MOVE, secondStep);
    try {
      await waitFor("PLAYER_MOVED (A seen by B)", () =>
        movedB.find((m) => m.sessionId === roomA.sessionId),
      );
      pass("PLAYER_MOVED received by B");
    } catch (e) {
      fail("PLAYER_MOVED received by B", (e as Error).message);
    }
  } else {
    fail("find a second walkable step for A");
  }

  // 4. SET_STATUS FOCUS -> PRESENCE FOCUS/MANUAL.
  const setFocus: SetStatusPayload = { state: "FOCUS" };
  roomA.send(C2S.SET_STATUS, setFocus);
  try {
    await waitFor(
      "PRESENCE FOCUS/MANUAL",
      () =>
        presenceA.find(
          (p) =>
            p.sessionId === roomA.sessionId &&
            p.state === PresenceState.FOCUS &&
            p.source === "MANUAL",
        ),
      7000,
    );
    pass("PRESENCE FOCUS/MANUAL after SET_STATUS");
  } catch (e) {
    fail("PRESENCE FOCUS/MANUAL after SET_STATUS", (e as Error).message);
  }

  // Reset to AVAILABLE so the event-break can take effect cleanly.
  roomA.send(C2S.SET_STATUS, { state: "AVAILABLE" } satisfies SetStatusPayload);

  // 5. POST /api/events -> EVENT_CREATED.
  let createdEventId = "";
  try {
    const resp = await fetch(`${HTTP}/api/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "COFFEE_BREAK" }),
    });
    const json = (await resp.json()) as { event?: { id: string } };
    const seen = await waitFor("EVENT_CREATED", () => eventsCreatedA[0]);
    createdEventId = json.event?.id ?? seen.event.id;
    pass("EVENT_CREATED received after POST /api/events");
  } catch (e) {
    fail("EVENT_CREATED received after POST /api/events", (e as Error).message);
  }

  // 6. JOIN_EVENT -> PLAYER_TELEPORTED to a Coffee Area anchor + PRESENCE BREAK/EVENT.
  if (createdEventId) {
    const coffeeAnchors = map.anchors["Coffee Area"] ?? [];
    roomA.send(C2S.JOIN_EVENT, { eventId: createdEventId });
    try {
      await waitFor(
        "PLAYER_TELEPORTED to Coffee Area",
        () =>
          teleportsA.find(
            (t) =>
              t.sessionId === roomA.sessionId &&
              coffeeAnchors.some((a) => a.x === t.x && a.y === t.y),
          ),
        7000,
      );
      pass("PLAYER_TELEPORTED to a Coffee Area anchor");
    } catch (e) {
      fail("PLAYER_TELEPORTED to a Coffee Area anchor", (e as Error).message);
    }
    try {
      await waitFor(
        "PRESENCE BREAK/EVENT",
        () =>
          presenceA.find(
            (p) =>
              p.sessionId === roomA.sessionId &&
              p.state === PresenceState.BREAK &&
              p.source === "EVENT",
          ),
        7000,
      );
      pass("PRESENCE BREAK/EVENT after JOIN_EVENT");
    } catch (e) {
      fail("PRESENCE BREAK/EVENT after JOIN_EVENT", (e as Error).message);
    }
  } else {
    fail("JOIN_EVENT (no event id from previous step)");
  }

  // 7. POST /api/meetings -> MEETING_STARTED within 7s (tick is ~3s).
  try {
    await fetch(`${HTTP}/api/meetings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Smoke Standup" }),
    });
    await waitFor(
      "MEETING_STARTED",
      () => meetingsStartedA.find((m) => m.meeting.title === "Smoke Standup"),
      7000,
    );
    pass("MEETING_STARTED received after POST /api/meetings");
  } catch (e) {
    fail("MEETING_STARTED received after POST /api/meetings", (e as Error).message);
  }

  await roomA.leave();
  await roomB.leave();
}

/** Pick a walkable adjacent tile, preferring `preferDir` if walkable. */
function pickWalkableStep(
  map: ReturnType<typeof buildOfficeMap>,
  x: number,
  y: number,
  preferDir?: Direction,
): MovePayload | null {
  const candidates: Array<{ dir: Direction; x: number; y: number }> = [
    { dir: "up", x, y: y - 1 },
    { dir: "down", x, y: y + 1 },
    { dir: "left", x: x - 1, y },
    { dir: "right", x: x + 1, y },
  ];
  if (preferDir) {
    candidates.sort((a) => (a.dir === preferDir ? -1 : 0));
  }
  for (const c of candidates) {
    if (isWalkable(map, c.x, c.y)) {
      return { x: c.x, y: c.y, dir: c.dir, moving: true };
    }
  }
  return null;
}

const hardTimeout = setTimeout(() => {
  console.log("FAIL  hard timeout (30s) — server unresponsive");
  process.exit(1);
}, HARD_TIMEOUT_MS);
hardTimeout.unref?.();

main()
  .then(() => {
    clearTimeout(hardTimeout);
    if (failures > 0) {
      console.log(`\n${failures} step(s) FAILED`);
      process.exit(1);
    }
    console.log("\nALL SMOKE STEPS PASSED");
    process.exit(0);
  })
  .catch((err) => {
    clearTimeout(hardTimeout);
    console.log(`FAIL  unexpected error — ${(err as Error).message}`);
    process.exit(1);
  });
