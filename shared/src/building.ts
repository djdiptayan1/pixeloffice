// ---------------------------------------------------------------------------
// Multi-floor building model.
//
// A Building is an ordered stack of Floors. A Floor is exactly an OfficeMap
// (areas / desks / furniture / walls / collision / anchors / spawn) PLUS a
// floor identity (id / name / index) and a set of Portals (elevator / stairs)
// that link it to other floors.
//
// HUMAN AGENCY: a Portal NEVER auto-moves a player. It only takes effect when a
// player walks their OWN avatar onto the portal tile (server detects this on a
// committed MOVE) — nothing teleports anyone without their own action.
//
// BACKWARD COMPATIBILITY: the existing single-floor `buildOfficeMap()` in
// map.ts is unchanged and stays the source of truth for the Ground floor's
// layout. `buildDefaultBuilding().floors[0]` is derived from it verbatim, so all
// existing tests / smoke assertions on the default floor keep passing.
//
// All coordinates are TILE coordinates. solid[y][x] indexing (same as OfficeMap).
// ---------------------------------------------------------------------------

import type { Department } from "./types";
import {
  MAP_W,
  MAP_H,
  buildOfficeMap,
  type Area,
  type Desk,
  type Furniture,
  type FurnitureKind,
  type OfficeMap,
  type TilePos,
} from "./map";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PortalKind = "elevator" | "stairs";

/**
 * A tile that links two floors. When a player STEPS onto (x,y) on the floor
 * that owns this portal (their own committed movement = agency preserved), the
 * server moves them to (toX,toY) on `toFloorId` and sends FLOOR_CHANGED.
 */
export interface Portal {
  x: number;
  y: number;
  kind: PortalKind;
  /** Destination floor id (must exist in the same Building). */
  toFloorId: string;
  /** Destination tile on the target floor (must be walkable). */
  toX: number;
  toY: number;
  label?: string;
}

/**
 * A single floor. Structurally a superset of OfficeMap so EVERY existing helper
 * that takes an OfficeMap (areaAt / isWalkable / anchorFor) works on a Floor
 * unchanged.
 */
export interface Floor extends OfficeMap {
  /** Stable floor id, e.g. "ground" | "floor-1" | "floor-2". */
  id: string;
  /** Human label, e.g. "Ground Floor". */
  name: string;
  /** Stacking order: 0 = ground, ascending upward. */
  index: number;
  /** Inter-floor links owned by THIS floor (the tiles a player steps on here). */
  portals: Portal[];
}

/** A building is an ordered stack of floors (sorted ascending by index). */
export interface Building {
  id: string;
  name: string;
  floors: Floor[];
}

// ---------------------------------------------------------------------------
// Serialization format (what Map Studio saves/loads + /api/maps transports)
// ---------------------------------------------------------------------------

/** Wire/JSON form of a Floor. Identical field shape to Floor (all JSON-safe). */
export interface FloorJSON {
  id: string;
  name: string;
  index: number;
  width: number;
  height: number;
  areas: Area[];
  desks: Desk[];
  furniture: Furniture[];
  walls: TilePos[];
  solid: boolean[][];
  anchors: Record<string, TilePos[]>;
  spawn: TilePos;
  portals: Portal[];
}

export interface BuildingJSON {
  id: string;
  name: string;
  floors: FloorJSON[];
}

// ---------------------------------------------------------------------------
// Default building (3 floors)
// ---------------------------------------------------------------------------

export const GROUND_FLOOR_ID = "ground";
export const FLOOR_1_ID = "floor-1";
export const FLOOR_2_ID = "floor-2";
export const DEFAULT_BUILDING_ID = "default";

/** Elevator tile on the Ground floor (near reception) that goes UP to floor-1. */
const GROUND_ELEVATOR: TilePos = { x: 44, y: 31 };

let cachedBuilding: Building | null = null;

/**
 * Seed the default 3-floor building.
 *  - floors[0] "Ground Floor": the EXACT current buildOfficeMap() layout, plus
 *    a single elevator near reception that goes up to floor-1. (Placeholder the
 *    user redraws in Map Studio — see MULTIFLOOR-CONTRACT.md.)
 *  - floors[1] "Floor 1": fresh 48x34 — four corner cabins, central desks,
 *    coffee nook, elevator down to ground + up to floor-2.
 *  - floors[2] "Floor 2": fresh 48x34 — four corner cabins, central desks,
 *    coffee nook, elevator down to floor-1 only.
 */
export function buildDefaultBuilding(): Building {
  if (cachedBuilding) return cachedBuilding;

  const ground = buildGroundFloor();
  const floor1 = buildUpperFloor({
    id: FLOOR_1_ID,
    name: "Floor 1",
    index: 1,
    downToFloorId: GROUND_FLOOR_ID,
    downToTile: { x: GROUND_ELEVATOR.x, y: GROUND_ELEVATOR.y - 1 }, // beside ground elevator
    upToFloorId: FLOOR_2_ID,
  });
  const floor2 = buildUpperFloor({
    id: FLOOR_2_ID,
    name: "Floor 2",
    index: 2,
    downToFloorId: FLOOR_1_ID,
    // filled in after floor1's elevator tile is known (see below).
    downToTile: null,
    upToFloorId: null,
  });

  // Resolve floor-2's "down" target to land NEXT TO floor-1's elevator tile so
  // a player arriving from above does not immediately re-trigger the portal.
  const f1Elevator = floor1.portals.find((p) => p.kind === "elevator")!;
  for (const p of floor2.portals) {
    if (p.toFloorId === FLOOR_1_ID) {
      p.toX = f1Elevator.x;
      p.toY = f1Elevator.y + 1; // tile just below floor-1's elevator (walkable)
    }
  }
  // And floor-1's "up" target lands next to floor-2's elevator.
  const f2Elevator = floor2.portals.find((p) => p.kind === "elevator")!;
  for (const p of floor1.portals) {
    if (p.toFloorId === FLOOR_2_ID) {
      p.toX = f2Elevator.x;
      p.toY = f2Elevator.y + 1;
    }
  }

  cachedBuilding = {
    id: DEFAULT_BUILDING_ID,
    name: "PixelOffice HQ",
    floors: [ground, floor1, floor2],
  };
  return cachedBuilding;
}

/**
 * Ground floor = the current single OfficeMap, deep-cloned (so callers can never
 * mutate the buildOfficeMap() cache through the building), plus floor identity
 * and one elevator portal up to floor-1.
 */
function buildGroundFloor(): Floor {
  const base = cloneOfficeMap(buildOfficeMap());

  // The elevator tile must be walkable on the ground floor so the player can
  // step onto it. It sits in Reception (already an open, walkable area).
  const ex = GROUND_ELEVATOR.x;
  const ey = GROUND_ELEVATOR.y;
  // Render an elevator marker. Keep it NON-solid (it is a walkable portal tile).
  base.furniture.push({ kind: "elevator", x: ex, y: ey, w: 1, h: 1, solid: false });

  const portals: Portal[] = [
    {
      x: ex,
      y: ey,
      kind: "elevator",
      toFloorId: FLOOR_1_ID,
      // toX/toY are patched in buildDefaultBuilding() to land beside floor-1's
      // elevator; a sane default in case this floor is used standalone.
      toX: ex,
      toY: ey,
      label: "Elevator ↑ Floor 1",
    },
  ];

  return {
    ...base,
    id: GROUND_FLOOR_ID,
    name: "Ground Floor",
    index: 0,
    portals,
  };
}

interface UpperFloorSpec {
  id: string;
  name: string;
  index: number;
  downToFloorId: string;
  downToTile: TilePos | null;
  upToFloorId: string | null;
}

/**
 * Build a fresh upper floor: a 48x34 room bordered by walls, four corner cabins
 * (~7x6 with a door, a desk + chair), a central department desk cluster, a small
 * coffee nook, and an elevator near the center connecting to the floor below
 * (always) and the floor above (when upToFloorId is set).
 */
function buildUpperFloor(spec: UpperFloorSpec): Floor {
  const width = MAP_W;
  const height = MAP_H;

  const areas: Area[] = [];
  const desks: Desk[] = [];
  const furniture: Furniture[] = [];
  const walls: TilePos[] = [];
  const anchors: Record<string, TilePos[]> = {};

  // Outer border (solid).
  for (let x = 0; x < width; x++) {
    walls.push({ x, y: 0 }, { x, y: height - 1 });
  }
  for (let y = 1; y < height - 1; y++) {
    walls.push({ x: 0, y }, { x: width - 1, y });
  }

  // Departments cycle across cabins so meetings/desks have sensible owners.
  const DEPTS: Department[] = ["Engineering", "Product", "Design", "HR"];

  // --- Four corner cabins (7x6) -------------------------------------------
  const CW = 7;
  const CH = 6;
  const cabins: Array<{ name: string; x: number; y: number; door: TilePos; dept: Department }> = [
    {
      name: "Cabin NW",
      x: 1,
      y: 1,
      door: { x: 1 + Math.floor(CW / 2), y: 1 + CH - 1 }, // bottom wall door
      dept: DEPTS[0],
    },
    {
      name: "Cabin NE",
      x: width - 1 - CW,
      y: 1,
      door: { x: width - 1 - CW + Math.floor(CW / 2), y: 1 + CH - 1 },
      dept: DEPTS[1],
    },
    {
      name: "Cabin SW",
      x: 1,
      y: height - 1 - CH,
      door: { x: 1 + Math.floor(CW / 2), y: height - 1 - CH }, // top wall door
      dept: DEPTS[2],
    },
    {
      name: "Cabin SE",
      x: width - 1 - CW,
      y: height - 1 - CH,
      door: { x: width - 1 - CW + Math.floor(CW / 2), y: height - 1 - CH },
      dept: DEPTS[3],
    },
  ];

  for (const c of cabins) {
    areas.push({ name: c.name, type: "MEETING_ROOM", department: c.dept, x: c.x, y: c.y, w: CW, h: CH });
    // Cabin perimeter walls minus the door tile.
    for (const t of rectPerimeter(c.x, c.y, CW, CH)) {
      if (t.x === c.door.x && t.y === c.door.y) continue;
      walls.push(t);
    }
    // A table in the cabin centre (solid) + a chair anchor row.
    const tableX = c.x + 2;
    const tableY = c.y + 2;
    furniture.push({ kind: "table", x: tableX, y: tableY, w: 2, h: 1, solid: true });
    furniture.push({ kind: "whiteboard", x: c.x + 1, y: c.y + 1, w: 2, h: 1, solid: true });
    // Standing anchors: interior tiles around the table (all walkable, used only
    // after an explicit Join — human agency).
    anchors[c.name] = [
      { x: c.x + 1, y: c.y + 3 },
      { x: c.x + 2, y: c.y + 3 },
      { x: c.x + 3, y: c.y + 3 },
      { x: c.x + 4, y: c.y + 3 },
      { x: c.x + 1, y: c.y + 4 },
      { x: c.x + 5, y: c.y + 4 },
    ];
  }

  // --- Central open desk cluster (a few department desks) ------------------
  // Place a 2-row desk grid in the middle, each a 2x1 desk + walkable seat below.
  const deptArea: Area = {
    name: `${spec.name} Floor`,
    type: "DEPARTMENT",
    department: DEPTS[0],
    x: 16,
    y: 11,
    w: 16,
    h: 12,
  };
  areas.push(deptArea);
  const deskXs = [17, 21, 25, 29];
  const deskYs = [13, 18];
  for (let r = 0; r < deskYs.length; r++) {
    for (let ci = 0; ci < deskXs.length; ci++) {
      const dx = deskXs[ci];
      const dy = deskYs[r];
      const dept = DEPTS[ci % DEPTS.length];
      desks.push({ x: dx, y: dy, seatX: dx, seatY: dy + 1, department: dept });
      furniture.push({ kind: deptDeskKind(dept), x: dx, y: dy, w: 2, h: 1, solid: true });
      furniture.push({ kind: deptChairKind(dept), x: dx, y: dy + 1, w: 1, h: 1, solid: false });
    }
  }

  // --- Coffee nook (small) ------------------------------------------------
  // A compact coffee area along the top-center, between the two north cabins.
  const coffee: Area = { name: "Coffee Area", type: "COFFEE", x: 18, y: 1, w: 12, h: 4 };
  areas.push(coffee);
  furniture.push({ kind: "counter", x: 19, y: 2, w: 4, h: 1, solid: true });
  furniture.push({ kind: "coffee-machine", x: 19, y: 2, w: 1, h: 1, solid: true });
  furniture.push({ kind: "table", x: 25, y: 3, w: 1, h: 1, solid: true });
  furniture.push({ kind: "plant", x: 28, y: 2, w: 1, h: 1, solid: true });
  anchors["Coffee Area"] = [
    { x: 20, y: 3 },
    { x: 21, y: 3 },
    { x: 22, y: 3 },
    { x: 24, y: 3 },
    { x: 26, y: 3 },
    { x: 27, y: 3 },
  ];

  // --- Elevator (center-bottom open floor) --------------------------------
  // Two portal tiles share a small lobby so "up" and "down" do not overlap.
  const elevDownX = 23;
  const elevY = 27;
  furniture.push({ kind: "elevator", x: elevDownX, y: elevY, w: 1, h: 1, solid: false });

  const portals: Portal[] = [
    {
      x: elevDownX,
      y: elevY,
      kind: "elevator",
      toFloorId: spec.downToFloorId,
      toX: spec.downToTile?.x ?? elevDownX,
      toY: spec.downToTile?.y ?? elevY + 1,
      label: `Elevator ↓ ${spec.downToFloorId}`,
    },
  ];

  if (spec.upToFloorId) {
    const elevUpX = 25;
    furniture.push({ kind: "elevator", x: elevUpX, y: elevY, w: 1, h: 1, solid: false });
    portals.push({
      x: elevUpX,
      y: elevY,
      kind: "elevator",
      toFloorId: spec.upToFloorId,
      // Patched in buildDefaultBuilding(); default lands on itself's lobby.
      toX: elevUpX,
      toY: elevY + 1,
      label: `Elevator ↑ ${spec.upToFloorId}`,
    });
  }

  // Decorative plants in the open hall corners of the central area.
  furniture.push({ kind: "plant", x: 16, y: 24, w: 1, h: 1, solid: true });
  furniture.push({ kind: "plant", x: 31, y: 24, w: 1, h: 1, solid: true });

  // --- Collision grid ------------------------------------------------------
  const solid: boolean[][] = Array.from({ length: height }, () => Array<boolean>(width).fill(false));
  for (const w of walls) solid[w.y][w.x] = true;
  for (const f of furniture) {
    if (!f.solid) continue;
    for (let dy = 0; dy < f.h; dy++) {
      for (let dx = 0; dx < f.w; dx++) {
        solid[f.y + dy][f.x + dx] = true;
      }
    }
  }

  // Spawn: a guaranteed-walkable open tile near the elevator lobby.
  const spawn = firstWalkable(solid, width, height, [
    { x: 24, y: 28 },
    { x: 23, y: 28 },
    { x: 22, y: 25 },
  ]);

  return {
    width,
    height,
    areas,
    desks,
    furniture,
    walls,
    solid,
    anchors,
    spawn,
    id: spec.id,
    name: spec.name,
    index: spec.index,
    portals,
  };
}

function deptDeskKind(dept: Department): FurnitureKind {
  switch (dept) {
    case "Engineering":
      return "desk-engineering";
    case "Product":
      return "desk-product";
    case "Design":
      return "desk-design";
    case "HR":
      return "desk-hr";
    default:
      return "desk";
  }
}

function deptChairKind(dept: Department): FurnitureKind {
  switch (dept) {
    case "Engineering":
      return "chair-engineering";
    case "Product":
      return "chair-product";
    case "Design":
      return "chair-design";
    case "HR":
      return "chair-hr";
    default:
      return "chair";
  }
}

/** Perimeter tiles of a rect (no door removal — caller filters the door). */
function rectPerimeter(x: number, y: number, w: number, h: number): TilePos[] {
  const tiles: TilePos[] = [];
  for (let cx = x; cx < x + w; cx++) {
    tiles.push({ x: cx, y }, { x: cx, y: y + h - 1 });
  }
  for (let cy = y + 1; cy < y + h - 1; cy++) {
    tiles.push({ x, y: cy }, { x: x + w - 1, y: cy });
  }
  return tiles;
}

/** Pick the first preferred tile that is walkable; else scan the grid. */
function firstWalkable(
  solid: boolean[][],
  width: number,
  height: number,
  preferred: TilePos[],
): TilePos {
  for (const p of preferred) {
    if (p.y >= 0 && p.y < height && p.x >= 0 && p.x < width && !solid[p.y][p.x]) return { ...p };
  }
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      if (!solid[y][x]) return { x, y };
    }
  }
  return { x: 1, y: 1 };
}

/** Deep clone an OfficeMap so the building never aliases the buildOfficeMap cache. */
function cloneOfficeMap(m: OfficeMap): OfficeMap {
  return {
    width: m.width,
    height: m.height,
    areas: m.areas.map((a) => ({ ...a })),
    desks: m.desks.map((d) => ({ ...d })),
    furniture: m.furniture.map((f) => ({ ...f })),
    walls: m.walls.map((w) => ({ ...w })),
    solid: m.solid.map((row) => row.slice()),
    anchors: Object.fromEntries(
      Object.entries(m.anchors).map(([k, v]) => [k, v.map((t) => ({ ...t }))]),
    ),
    spawn: { ...m.spawn },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Find a floor by id (or null). */
export function floorById(b: Building, id: string): Floor | null {
  return b.floors.find((f) => f.id === id) ?? null;
}

/** The portal whose tile is exactly (x,y) on this floor, or null. */
export function portalAt(floor: Floor, x: number, y: number): Portal | null {
  return floor.portals.find((p) => p.x === x && p.y === y) ?? null;
}

// ---------------------------------------------------------------------------
// Serialization + validation
// ---------------------------------------------------------------------------

/** A typed validation error from parseBuilding. */
export interface BuildingValidationError {
  code: string;
  message: string;
  floorId?: string;
}

export class BuildingParseError extends Error {
  readonly errors: BuildingValidationError[];
  constructor(errors: BuildingValidationError[]) {
    super(`Invalid building: ${errors.map((e) => e.message).join("; ")}`);
    this.name = "BuildingParseError";
    this.errors = errors;
  }
}

/** Serialize a Building to its JSON form (structural clone — JSON-safe). */
export function serializeBuilding(b: Building): BuildingJSON {
  return {
    id: b.id,
    name: b.name,
    floors: b.floors.map((f) => ({
      id: f.id,
      name: f.name,
      index: f.index,
      width: f.width,
      height: f.height,
      areas: f.areas.map((a) => ({ ...a })),
      desks: f.desks.map((d) => ({ ...d })),
      furniture: f.furniture.map((fn) => ({ ...fn })),
      walls: f.walls.map((w) => ({ ...w })),
      solid: f.solid.map((row) => row.slice()),
      anchors: Object.fromEntries(
        Object.entries(f.anchors).map(([k, v]) => [k, v.map((t) => ({ ...t }))]),
      ),
      spawn: { ...f.spawn },
      portals: f.portals.map((p) => ({ ...p })),
    })),
  };
}

/**
 * Parse + VALIDATE a BuildingJSON into a Building. Throws BuildingParseError
 * with a list of typed errors on any structural problem:
 *   - missing/empty id or floors
 *   - duplicate floor ids
 *   - grid dimension mismatch (solid is height x width)
 *   - spawn off-grid or on a solid tile
 *   - portal target floor missing OR target tile off-grid / on a solid tile
 * This is the format Map Studio saves and the /api/maps POST validates.
 */
export function parseBuilding(json: unknown): Building {
  const errors: BuildingValidationError[] = [];
  const j = json as Partial<BuildingJSON> | null | undefined;

  if (!j || typeof j !== "object") {
    throw new BuildingParseError([{ code: "NOT_OBJECT", message: "building must be an object" }]);
  }
  if (typeof j.id !== "string" || j.id.trim() === "") {
    errors.push({ code: "BAD_ID", message: "building.id must be a non-empty string" });
  }
  if (!Array.isArray(j.floors) || j.floors.length === 0) {
    throw new BuildingParseError([
      ...errors,
      { code: "NO_FLOORS", message: "building.floors must be a non-empty array" },
    ]);
  }

  const ids = new Set<string>();
  const floors: Floor[] = [];

  for (const rawFloor of j.floors) {
    const f = rawFloor as Partial<FloorJSON>;
    const fid = typeof f.id === "string" ? f.id : "";
    if (fid.trim() === "") {
      errors.push({ code: "BAD_FLOOR_ID", message: "floor.id must be a non-empty string" });
      continue;
    }
    if (ids.has(fid)) {
      errors.push({ code: "DUP_FLOOR_ID", message: `duplicate floor id "${fid}"`, floorId: fid });
      continue;
    }
    ids.add(fid);

    const width = f.width ?? 0;
    const height = f.height ?? 0;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
      errors.push({ code: "BAD_DIMS", message: `floor "${fid}" has invalid width/height`, floorId: fid });
      continue;
    }
    if (
      !Array.isArray(f.solid) ||
      f.solid.length !== height ||
      f.solid.some((row) => !Array.isArray(row) || row.length !== width)
    ) {
      errors.push({
        code: "BAD_GRID",
        message: `floor "${fid}" solid grid must be ${height}x${width}`,
        floorId: fid,
      });
      continue;
    }
    const spawn = f.spawn;
    if (
      !spawn ||
      !Number.isInteger(spawn.x) ||
      !Number.isInteger(spawn.y) ||
      spawn.x < 0 ||
      spawn.y < 0 ||
      spawn.x >= width ||
      spawn.y >= height ||
      f.solid[spawn.y][spawn.x] === true
    ) {
      errors.push({
        code: "BAD_SPAWN",
        message: `floor "${fid}" spawn must be an on-grid walkable tile`,
        floorId: fid,
      });
      continue;
    }

    floors.push({
      id: fid,
      name: typeof f.name === "string" ? f.name : fid,
      index: Number.isInteger(f.index) ? (f.index as number) : floors.length,
      width,
      height,
      areas: Array.isArray(f.areas) ? (f.areas as Area[]) : [],
      desks: Array.isArray(f.desks) ? (f.desks as Desk[]) : [],
      furniture: Array.isArray(f.furniture) ? (f.furniture as Furniture[]) : [],
      walls: Array.isArray(f.walls) ? (f.walls as TilePos[]) : [],
      solid: f.solid as boolean[][],
      anchors: (f.anchors as Record<string, TilePos[]>) ?? {},
      spawn: { x: spawn.x, y: spawn.y },
      portals: Array.isArray(f.portals) ? (f.portals as Portal[]) : [],
    });
  }

  // Cross-floor portal validation (only once every floor is structurally sound).
  if (errors.length === 0) {
    const byId = new Map(floors.map((f) => [f.id, f]));
    for (const floor of floors) {
      for (const p of floor.portals) {
        if (
          !Number.isInteger(p.x) ||
          !Number.isInteger(p.y) ||
          p.x < 0 ||
          p.y < 0 ||
          p.x >= floor.width ||
          p.y >= floor.height
        ) {
          errors.push({
            code: "BAD_PORTAL_TILE",
            message: `floor "${floor.id}" has a portal off-grid`,
            floorId: floor.id,
          });
          continue;
        }
        const target = byId.get(p.toFloorId);
        if (!target) {
          errors.push({
            code: "PORTAL_TARGET_MISSING",
            message: `floor "${floor.id}" portal targets unknown floor "${p.toFloorId}"`,
            floorId: floor.id,
          });
          continue;
        }
        if (
          !Number.isInteger(p.toX) ||
          !Number.isInteger(p.toY) ||
          p.toX < 0 ||
          p.toY < 0 ||
          p.toX >= target.width ||
          p.toY >= target.height ||
          target.solid[p.toY][p.toX] === true
        ) {
          errors.push({
            code: "PORTAL_TARGET_BLOCKED",
            message: `floor "${floor.id}" portal lands on a non-walkable tile of "${p.toFloorId}"`,
            floorId: floor.id,
          });
        }
      }
    }
  }

  if (errors.length > 0) throw new BuildingParseError(errors);

  // Order floors by index (Building invariant).
  floors.sort((a, b) => a.index - b.index);

  return {
    id: j.id as string,
    name: typeof j.name === "string" ? j.name : (j.id as string),
    floors,
  };
}
