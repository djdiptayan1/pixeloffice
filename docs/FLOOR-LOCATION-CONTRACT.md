# Floor-Location Contract (Foundation → Client)

OPT-IN physical-floor detection. Each office floor is on a different WiFi/subnet;
the SERVER maps the client IP to a floor (browsers cannot read the SSID). This is
sensitive, so it is **OFF BY DEFAULT** and entirely user-driven. Everything below
is additive and backward-compatible — `npm test` and `npm run smoke` stay green,
and with no `OFFICE_SUBNETS`/`OFFICE_CIDRS` env the feature is inert (everyone
untagged/neutral).

Code against these symbols verbatim (all exported from `@pixeloffice/shared`).

---

## 1. `PlayerSnapshot.place` (`shared/src/types.ts`)

```ts
interface PlayerSnapshot {
  /* ...existing... */
  place?: "OFFICE" | "REMOTE";
}
```

- `absent` (undefined) => the user has NOT enabled floor sync (default), or turned
  it off. **Render no location badge.**
- `"OFFICE"` => render `📍 Office · Floor N` (use `self.floorId` + the building
  floor list from `welcome.building` to resolve the floor name/number).
- `"REMOTE"` => render `🏠 Remote`.
- **ORTHOGONAL to `presence`**: a user can be `AVAILABLE` + `"OFFICE"`, `FOCUS` +
  `"REMOTE"`, etc. Never derive one from the other; show both independently.
- `place` is carried INLINE on every snapshot in `WELCOME.self`, `WELCOME.players`,
  `PLAYER_JOINED.player`, and `FLOOR_CHANGED.players`, so the badge is correct on
  first paint without waiting for an `S2C.LOCATION`.

---

## 2. C2S — `SET_LOCATION_SYNC` (`shared/src/protocol.ts`)

```ts
C2S.SET_LOCATION_SYNC = "set-location-sync";

interface SetLocationSyncPayload { enabled: boolean }
```

- The Settings toggle sends `{ enabled: true }` to opt in, `{ enabled: false }`
  to opt out. OFF by default — send nothing and the user stays untagged.
- The server rate-limits this on the shared action bucket and counts it as
  activity (clears auto-AWAY). NPCs are rejected.
- **On `enabled: true`** the server classifies the user's IP and replies with an
  `S2C.LOCATION` (see below). If the classification is `OFFICE` AND the IP maps
  to a real floor different from the user's current one, the server ALSO performs
  a normal floor change — you will then receive a standard `S2C.FLOOR_CHANGED`
  (same payload/handling as walking into an elevator). This movement is consented
  (the user flipped the switch); it is NOT auto-surveillance.
- **On `enabled: false`** the server clears the tag and sends a CLEARED
  `S2C.LOCATION`. **The avatar is never moved on opt-out.**
- **No office subnets configured** (zero-config default): the toggle still works,
  but every IP classifies `REMOTE` and nobody is moved.

---

## 3. S2C — `LOCATION` (`shared/src/protocol.ts`)

```ts
S2C.LOCATION = "location";

interface LocationPayload {
  sessionId: string;
  place: "OFFICE" | "REMOTE"; // the tag while sync is ON (legacy hint on a clear)
  cleared?: boolean;          // true => sync turned OFF: drop the badge
}
```

- Broadcast **FLOOR-SCOPED** (only clients on the same floor as the subject hear
  it), exactly like `PLAYER_MOVED` / `PRESENCE` / `PLAYER_UPDATED`.
- **Apply it to the matching player by `sessionId`:**
  - `cleared` truthy => set that player's `place` to **absent** (remove the
    badge). Do NOT show "Remote" — ignore the `place` hint on a cleared event.
  - otherwise => set that player's `place` to the payload `place` and render the
    badge accordingly.
- For the LOCAL user this is the confirmation that their toggle took effect; for
  others it is how they learn a co-located teammate tagged in/out.

### "Cleared / OFF" representation (exact)

Turning sync OFF emits `{ sessionId, place: "REMOTE", cleared: true }`. The
authoritative `place` becomes `undefined`. **Clients MUST branch on `cleared`
first** and treat a cleared player as having no `place` (badge hidden), NOT as
"Remote". The `place: "REMOTE"` value on a cleared event exists only so a client
that ignores `cleared` degrades to a harmless "Remote" rather than a crash.

---

## 4. Floor change on enable (exact behavior)

When `SET_LOCATION_SYNC { enabled: true }` results in `place === "OFFICE"` and the
detected floor differs from the current one, the server runs the SAME sequence as
an elevator crossing:

1. `S2C.LOCATION { place: "OFFICE" }` to the OLD floor (tag set),
2. `PLAYER_LEFT { sessionId }` to the OLD floor's other occupants,
3. `PLAYER_JOINED { player }` (new `floorId`/position, `place: "OFFICE"`) to the
   NEW floor's other occupants,
4. `S2C.FLOOR_CHANGED` to the mover (new floor's players/events) — handle it
   identically to an elevator floor change (tear down + rebuild from the payload).

If `place === "REMOTE"`, or the detected floor equals the current floor, or no
floor is detected, the user is tagged but NOT moved.

---

## 5. Server env (operator-facing; clients don't read these)

- `OFFICE_SUBNETS` — comma-separated `CIDR=floorId` pairs, e.g.
  `10.1.0.0/16=floor-1,10.2.0.0/16=floor-2,10.0.0.0/16=ground`. Maps a subnet to
  a floor (drives both `OFFICE` classification and the floor move).
- `OFFICE_CIDRS` — optional extra office ranges with no specific floor; an IP in
  one classifies `OFFICE` but is not moved to a floor.
- With NEITHER set, the feature is OFF: the toggle resolves `REMOTE`, nobody
  moves, and `place` stays absent for everyone.

---

## 6. Privacy (hard rule — plan.md "presence, not surveillance")

The server stores ONLY the transient Office/Remote tag + the current floor. It
NEVER logs or persists the client IP, and NEVER keeps a location history /
movement trace / who-was-on-which-floor-when. This is the user's own opt-in,
user-visible, user-revocable feature — never employer-forced tracking. The client
SHOULD present it that way: an off-by-default toggle with a clear privacy note and
a visible, dismissible badge.
