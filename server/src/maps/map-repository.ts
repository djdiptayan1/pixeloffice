// ---------------------------------------------------------------------------
// Map repository — the persistence seam for buildings/floors.
//
// The Colyseus room reads the ACTIVE building from here at create. Map Studio
// (Phase 2) lists / loads / saves / activates buildings through the REST routes
// in http/maps.routes.ts, which delegate here. The default seed is the
// 3-floor building from `buildDefaultBuilding()`.
//
// Framework-free: no Express, no Colyseus. The in-memory impl is the zero-config
// dev path; a DB/file-backed impl can implement the same interface in prod.
// ---------------------------------------------------------------------------

import {
  buildDefaultBuilding,
  serializeBuilding,
  parseBuilding,
  type Building,
  type BuildingJSON,
} from "@pixeloffice/shared";

/** A stored map record (a building + its active flag). */
export interface MapRecord {
  id: string;
  name: string;
  active: boolean;
}

export interface MapRepository {
  /** All stored maps as light records (no geometry). */
  listMaps(): MapRecord[];
  /** Full building JSON for an id, or null. */
  getMap(id: string): BuildingJSON | null;
  /**
   * Validate (via parseBuilding) + store a building JSON. Returns the parsed
   * Building. Throws BuildingParseError on invalid geometry. An existing id is
   * overwritten. Does NOT change the active map (call setActive separately).
   */
  saveMap(json: unknown): Building;
  /** Mark a stored map active. Returns false if the id is unknown. */
  setActive(id: string): boolean;
  /** The currently active building (parsed). Always non-null after construction. */
  getActiveBuilding(): Building;
  /** Id of the active building. */
  getActiveId(): string;
}

/**
 * In-memory MapRepository seeded with the default 3-floor building as the active
 * map. Stores buildings in their JSON form (the Map Studio save format) and
 * re-parses on read so the active building is always a freshly validated copy
 * (no shared mutable aliasing with the seed cache).
 *
 * Changing the active map applies to NEW joins only — live players keep their
 * session on whatever building/floor they are currently on (the room captured
 * its building reference at create). This is the documented, simple behavior.
 */
export class InMemoryMapRepository implements MapRepository {
  private readonly maps = new Map<string, BuildingJSON>();
  private activeId: string;

  constructor(seed: Building = buildDefaultBuilding()) {
    const json = serializeBuilding(seed);
    this.maps.set(json.id, json);
    this.activeId = json.id;
  }

  listMaps(): MapRecord[] {
    return Array.from(this.maps.values()).map((b) => ({
      id: b.id,
      name: b.name,
      active: b.id === this.activeId,
    }));
  }

  getMap(id: string): BuildingJSON | null {
    const found = this.maps.get(id);
    return found ? structuredClone(found) : null;
  }

  saveMap(json: unknown): Building {
    // parseBuilding throws BuildingParseError on invalid geometry — the caller
    // (REST route) maps that to a 400.
    const building = parseBuilding(json);
    this.maps.set(building.id, serializeBuilding(building));
    return building;
  }

  setActive(id: string): boolean {
    if (!this.maps.has(id)) return false;
    this.activeId = id;
    return true;
  }

  getActiveBuilding(): Building {
    const json = this.maps.get(this.activeId);
    // Construction guarantees the active id always resolves; re-parse for a
    // fresh, validated, non-aliased Building instance.
    if (!json) return buildDefaultBuilding();
    return parseBuilding(json);
  }

  getActiveId(): string {
    return this.activeId;
  }
}
