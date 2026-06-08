// ---------------------------------------------------------------------------
// Multi-floor building seed integrity + serialization round-trip + validation.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  buildDefaultBuilding,
  buildOfficeMap,
  serializeBuilding,
  parseBuilding,
  floorById,
  portalAt,
  isWalkable,
  BuildingParseError,
  GROUND_FLOOR_ID,
  FLOOR_1_ID,
  FLOOR_2_ID,
  type Building,
  type BuildingJSON,
  type Floor,
} from "@pixeloffice/shared";

function expectWalkable(floor: Floor, x: number, y: number): void {
  expect(x).toBeGreaterThanOrEqual(0);
  expect(y).toBeGreaterThanOrEqual(0);
  expect(x).toBeLessThan(floor.width);
  expect(y).toBeLessThan(floor.height);
  expect(isWalkable(floor, x, y)).toBe(true);
}

describe("buildDefaultBuilding seed", () => {
  const building = buildDefaultBuilding();

  it("has exactly three floors ordered by index", () => {
    expect(building.floors).toHaveLength(3);
    expect(building.floors.map((f) => f.index)).toEqual([0, 1, 2]);
    expect(building.floors.map((f) => f.id)).toEqual([GROUND_FLOOR_ID, FLOOR_1_ID, FLOOR_2_ID]);
  });

  it("ground floor preserves the exact legacy single-floor layout", () => {
    const ground = floorById(building, GROUND_FLOOR_ID)!;
    const legacy = buildOfficeMap();
    expect(ground.width).toBe(legacy.width);
    expect(ground.height).toBe(legacy.height);
    expect(ground.desks).toEqual(legacy.desks);
    expect(ground.areas).toEqual(legacy.areas);
    expect(ground.anchors).toEqual(legacy.anchors);
    expect(ground.spawn).toEqual(legacy.spawn);
    // Legacy collision grid must be byte-identical (so existing tests/smoke hold).
    expect(ground.solid).toEqual(legacy.solid);
  });

  it("ground floor has an elevator portal up to floor-1 on a walkable tile", () => {
    const ground = floorById(building, GROUND_FLOOR_ID)!;
    expect(ground.portals.length).toBeGreaterThanOrEqual(1);
    const up = ground.portals.find((p) => p.toFloorId === FLOOR_1_ID)!;
    expect(up).toBeTruthy();
    expect(up.kind).toBe("elevator");
    // The portal TILE is walkable (player must step onto it).
    expectWalkable(ground, up.x, up.y);
    // Its target tile is walkable on floor-1.
    const f1 = floorById(building, FLOOR_1_ID)!;
    expectWalkable(f1, up.toX, up.toY);
  });

  for (const fid of [FLOOR_1_ID, FLOOR_2_ID]) {
    describe(`upper floor ${fid}`, () => {
      const floor = floorById(building, fid)!;

      it("is a fresh 48x34 floor", () => {
        expect(floor.width).toBe(48);
        expect(floor.height).toBe(34);
      });

      it("has four corner cabins (NW/NE/SW/SE)", () => {
        const cabinNames = floor.areas.map((a) => a.name);
        for (const corner of ["Cabin NW", "Cabin NE", "Cabin SW", "Cabin SE"]) {
          expect(cabinNames).toContain(corner);
        }
        // Each cabin sits in a distinct corner quadrant.
        const nw = floor.areas.find((a) => a.name === "Cabin NW")!;
        const ne = floor.areas.find((a) => a.name === "Cabin NE")!;
        const sw = floor.areas.find((a) => a.name === "Cabin SW")!;
        const se = floor.areas.find((a) => a.name === "Cabin SE")!;
        expect(nw.x).toBeLessThan(floor.width / 2);
        expect(nw.y).toBeLessThan(floor.height / 2);
        expect(ne.x).toBeGreaterThan(floor.width / 2);
        expect(ne.y).toBeLessThan(floor.height / 2);
        expect(sw.x).toBeLessThan(floor.width / 2);
        expect(sw.y).toBeGreaterThan(floor.height / 2);
        expect(se.x).toBeGreaterThan(floor.width / 2);
        expect(se.y).toBeGreaterThan(floor.height / 2);
      });

      it("has a walkable spawn", () => {
        expectWalkable(floor, floor.spawn.x, floor.spawn.y);
      });

      it("each cabin has walkable anchors", () => {
        for (const corner of ["Cabin NW", "Cabin NE", "Cabin SW", "Cabin SE"]) {
          const anchors = floor.anchors[corner];
          expect(anchors).toBeTruthy();
          expect(anchors.length).toBeGreaterThan(0);
          for (const a of anchors) expectWalkable(floor, a.x, a.y);
        }
      });

      it("has at least one walkable desk seat", () => {
        expect(floor.desks.length).toBeGreaterThan(0);
        for (const d of floor.desks) expectWalkable(floor, d.seatX, d.seatY);
      });

      it("every portal tile is walkable and targets a valid walkable tile", () => {
        expect(floor.portals.length).toBeGreaterThanOrEqual(1);
        for (const p of floor.portals) {
          expectWalkable(floor, p.x, p.y);
          const target = floorById(building, p.toFloorId)!;
          expect(target).toBeTruthy();
          expectWalkable(target, p.toX, p.toY);
        }
      });
    });
  }

  it("floor-1 links down to ground and up to floor-2", () => {
    const f1 = floorById(building, FLOOR_1_ID)!;
    const targets = f1.portals.map((p) => p.toFloorId).sort();
    expect(targets).toEqual([FLOOR_2_ID, GROUND_FLOOR_ID].sort());
  });

  it("floor-2 elevator only goes down (to floor-1)", () => {
    const f2 = floorById(building, FLOOR_2_ID)!;
    const targets = f2.portals.map((p) => p.toFloorId);
    expect(targets).toContain(FLOOR_1_ID);
    expect(targets).not.toContain(FLOOR_2_ID);
    // No upward link from the top floor.
    expect(f2.portals.every((p) => p.toFloorId !== "floor-3")).toBe(true);
  });

  it("portalAt resolves a portal tile and returns null elsewhere", () => {
    const f1 = floorById(building, FLOOR_1_ID)!;
    const p = f1.portals[0];
    expect(portalAt(f1, p.x, p.y)).toEqual(p);
    expect(portalAt(f1, -1, -1)).toBeNull();
  });
});

describe("serialize -> parse round-trip", () => {
  it("round-trips the default building losslessly", () => {
    const building = buildDefaultBuilding();
    const json = serializeBuilding(building);
    const parsed = parseBuilding(json);
    // Re-serialize both to compare structurally (parse sorts floors by index).
    expect(serializeBuilding(parsed)).toEqual(json);
  });

  it("parses a minimal valid building", () => {
    const json = minimalBuildingJSON();
    const parsed: Building = parseBuilding(json);
    expect(parsed.floors).toHaveLength(1);
    expect(parsed.floors[0].id).toBe("g");
  });
});

describe("parseBuilding validation", () => {
  it("rejects duplicate floor ids", () => {
    const json = minimalBuildingJSON();
    json.floors.push(JSON.parse(JSON.stringify(json.floors[0])));
    expect(() => parseBuilding(json)).toThrow(BuildingParseError);
    try {
      parseBuilding(json);
    } catch (e) {
      expect((e as BuildingParseError).errors.some((x) => x.code === "DUP_FLOOR_ID")).toBe(true);
    }
  });

  it("rejects a solid grid whose dimensions mismatch", () => {
    const json = minimalBuildingJSON();
    json.floors[0].solid = [[false, false]]; // wrong dims
    expect(() => parseBuilding(json)).toThrow(BuildingParseError);
  });

  it("rejects a spawn on a solid tile", () => {
    const json = minimalBuildingJSON();
    json.floors[0].solid[json.floors[0].spawn.y][json.floors[0].spawn.x] = true;
    expect(() => parseBuilding(json)).toThrow(/spawn/);
  });

  it("rejects a portal targeting a missing floor", () => {
    const json = minimalBuildingJSON();
    json.floors[0].portals = [
      { x: 1, y: 1, kind: "elevator", toFloorId: "nope", toX: 1, toY: 1 },
    ];
    expect(() => parseBuilding(json)).toThrow(BuildingParseError);
    try {
      parseBuilding(json);
    } catch (e) {
      expect((e as BuildingParseError).errors.some((x) => x.code === "PORTAL_TARGET_MISSING")).toBe(true);
    }
  });

  it("rejects a portal landing on a non-walkable target tile", () => {
    const json = minimalBuildingJSON();
    // self-target portal onto a solid tile.
    json.floors[0].solid[2][2] = true;
    json.floors[0].portals = [
      { x: 1, y: 1, kind: "elevator", toFloorId: "g", toX: 2, toY: 2 },
    ];
    expect(() => parseBuilding(json)).toThrow(/non-walkable/);
  });

  it("rejects an empty floors array", () => {
    expect(() => parseBuilding({ id: "b", name: "B", floors: [] })).toThrow(BuildingParseError);
  });
});

// A tiny 4x4 single-floor building, fully walkable interior.
function minimalBuildingJSON(): BuildingJSON {
  const w = 4;
  const h = 4;
  const solid: boolean[][] = Array.from({ length: h }, () => Array<boolean>(w).fill(false));
  return {
    id: "b",
    name: "B",
    floors: [
      {
        id: "g",
        name: "G",
        index: 0,
        width: w,
        height: h,
        areas: [],
        desks: [],
        furniture: [],
        walls: [],
        solid,
        anchors: {},
        spawn: { x: 1, y: 1 },
        portals: [],
      },
    ],
  };
}
