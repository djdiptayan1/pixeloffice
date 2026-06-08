// ---------------------------------------------------------------------------
// applyFloorReport gate tests.
//
// Booting a real Colyseus room (ws-transport + container singletons) for a unit
// test is impractical, so — exactly as emote.test.ts does — we mirror the
// decision pipeline of OfficeRoom.applyFloorReport built from the SAME state
// shape the room keeps (sessionIp + locationSync maps). This pins the contract:
//   - only sessions whose captured IP == the report's IP are considered
//   - of those, only sessions that OPTED IN (locationSync=true) are updated
//   - a same-floor report tags but does not change floor; a different floor does
//   - the SSID/IP are never logged (nothing here logs).
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";

interface Session {
  sessionId: string;
  ip: string | undefined;
  optedIn: boolean;
  floorId: string;
  isNpc?: boolean;
}

interface Outcome {
  matched: number;
  /** sessionId -> resulting floorId (for the consented-change assertion). */
  floors: Record<string, string>;
  /** sessionId -> place tag after the report. */
  places: Record<string, string | undefined>;
}

/**
 * Mirror of OfficeRoom.applyFloorReport's gate + consented-change decision. The
 * real room additionally performs the wire broadcasts via changeFloor; here we
 * assert the STATE transitions that drive them.
 */
function applyFloorReport(
  sessions: Session[],
  clientIp: string | undefined,
  floorId: string,
  validFloorIds: Set<string>,
): Outcome {
  const out: Outcome = { matched: 0, floors: {}, places: {} };
  for (const s of sessions) out.floors[s.sessionId] = s.floorId;
  for (const s of sessions) out.places[s.sessionId] = undefined;

  if (!clientIp || !validFloorIds.has(floorId)) return out;
  for (const s of sessions) {
    if (s.ip !== clientIp) continue; // not this machine
    if (s.optedIn !== true) continue; // OPT-IN gate
    if (s.isNpc) continue; // never tag an NPC
    out.places[s.sessionId] = "OFFICE";
    if (s.floorId !== floorId) out.floors[s.sessionId] = floorId; // consented change
    out.matched += 1;
  }
  return out;
}

const FLOORS = new Set(["ground", "floor-1", "floor-2"]);

describe("applyFloorReport gate", () => {
  it("moves an opted-in session whose IP matches to the reported floor", () => {
    const r = applyFloorReport(
      [{ sessionId: "a", ip: "10.0.0.5", optedIn: true, floorId: "floor-2" }],
      "10.0.0.5",
      "ground",
      FLOORS,
    );
    expect(r.matched).toBe(1);
    expect(r.floors.a).toBe("ground"); // consented floor change
    expect(r.places.a).toBe("OFFICE");
  });

  it("tags but does NOT change floor when already on the reported floor", () => {
    const r = applyFloorReport(
      [{ sessionId: "a", ip: "10.0.0.5", optedIn: true, floorId: "floor-2" }],
      "10.0.0.5",
      "floor-2",
      FLOORS,
    );
    expect(r.matched).toBe(1);
    expect(r.floors.a).toBe("floor-2"); // unchanged
    expect(r.places.a).toBe("OFFICE");
  });

  it("leaves a NOT-opted-in session untouched (matched=0)", () => {
    const r = applyFloorReport(
      [{ sessionId: "a", ip: "10.0.0.5", optedIn: false, floorId: "floor-2" }],
      "10.0.0.5",
      "ground",
      FLOORS,
    );
    expect(r.matched).toBe(0);
    expect(r.floors.a).toBe("floor-2"); // never moved
    expect(r.places.a).toBeUndefined(); // never tagged
  });

  it("ignores sessions on a DIFFERENT IP (a different machine)", () => {
    const r = applyFloorReport(
      [
        { sessionId: "mine", ip: "10.0.0.5", optedIn: true, floorId: "floor-2" },
        { sessionId: "theirs", ip: "10.0.0.9", optedIn: true, floorId: "floor-2" },
      ],
      "10.0.0.5",
      "ground",
      FLOORS,
    );
    expect(r.matched).toBe(1);
    expect(r.floors.mine).toBe("ground");
    expect(r.floors.theirs).toBe("floor-2"); // untouched — different machine
  });

  it("never acts on an NPC even if it shares the IP and is opted in", () => {
    const r = applyFloorReport(
      [{ sessionId: "npc", ip: "10.0.0.5", optedIn: true, floorId: "floor-2", isNpc: true }],
      "10.0.0.5",
      "ground",
      FLOORS,
    );
    expect(r.matched).toBe(0);
  });

  it("is a no-op for an unknown floor id or absent IP", () => {
    expect(
      applyFloorReport(
        [{ sessionId: "a", ip: "10.0.0.5", optedIn: true, floorId: "floor-2" }],
        "10.0.0.5",
        "floor-99",
        FLOORS,
      ).matched,
    ).toBe(0);
    expect(
      applyFloorReport(
        [{ sessionId: "a", ip: "10.0.0.5", optedIn: true, floorId: "floor-2" }],
        undefined,
        "ground",
        FLOORS,
      ).matched,
    ).toBe(0);
  });
});
