// ---------------------------------------------------------------------------
// InMemoryMapRepository: seed/active behavior + save validation + activate.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { BuildingParseError, DEFAULT_BUILDING_ID } from "@pixeloffice/shared";
import { InMemoryMapRepository } from "./map-repository";

describe("InMemoryMapRepository", () => {
  it("seeds the default building as the active map", () => {
    const repo = new InMemoryMapRepository();
    expect(repo.getActiveId()).toBe(DEFAULT_BUILDING_ID);
    const active = repo.getActiveBuilding();
    expect(active.id).toBe(DEFAULT_BUILDING_ID);
    expect(active.floors).toHaveLength(3);
    const list = repo.listMaps();
    expect(list).toHaveLength(1);
    expect(list[0].active).toBe(true);
  });

  it("getActiveBuilding returns a fresh (non-aliased) instance each call", () => {
    const repo = new InMemoryMapRepository();
    const a = repo.getActiveBuilding();
    const b = repo.getActiveBuilding();
    expect(a).not.toBe(b);
    a.floors[0].spawn.x = -999;
    // Mutating a must not affect a subsequent read.
    expect(repo.getActiveBuilding().floors[0].spawn.x).not.toBe(-999);
  });

  it("saveMap validates geometry (throws on bad grid)", () => {
    const repo = new InMemoryMapRepository();
    expect(() =>
      repo.saveMap({
        id: "bad",
        name: "Bad",
        floors: [
          {
            id: "g",
            name: "G",
            index: 0,
            width: 4,
            height: 4,
            areas: [],
            desks: [],
            furniture: [],
            walls: [],
            solid: [[false]], // wrong dims
            anchors: {},
            spawn: { x: 1, y: 1 },
            portals: [],
          },
        ],
      }),
    ).toThrow(BuildingParseError);
  });

  it("saves a valid building and can activate it (new active for new joins)", () => {
    const repo = new InMemoryMapRepository();
    const w = 4;
    const h = 4;
    const solid = Array.from({ length: h }, () => Array<boolean>(w).fill(false));
    const saved = repo.saveMap({
      id: "studio-1",
      name: "Studio One",
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
    });
    expect(saved.id).toBe("studio-1");
    expect(repo.listMaps()).toHaveLength(2);

    expect(repo.setActive("studio-1")).toBe(true);
    expect(repo.getActiveId()).toBe("studio-1");
    expect(repo.getActiveBuilding().id).toBe("studio-1");

    expect(repo.setActive("does-not-exist")).toBe(false);
  });
});
