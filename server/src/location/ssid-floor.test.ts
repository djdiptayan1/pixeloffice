// ---------------------------------------------------------------------------
// SSID -> floor resolver tests — substring matching (case-insensitive + band
// suffix tolerance), the default KALVIUM map, custom SSID_FLOOR_MAP env, floor
// validation against the active building, and {matched}/enabled() semantics.
//
// The resolver is pure + framework-free, so these are direct unit tests. PRIVACY
// note: there is nothing to assert about logging because the module never logs.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import {
  DefaultSsidFloorResolver,
  createSsidFloorResolver,
  parseSsidFloorMap,
  DEFAULT_SSID_FLOOR_MAP,
} from "./ssid-floor";

describe("parseSsidFloorMap", () => {
  it("falls back to the KALVIUM default when unset/empty", () => {
    expect(parseSsidFloorMap(undefined)).toHaveLength(3);
    expect(parseSsidFloorMap("")).toHaveLength(3);
    expect(parseSsidFloorMap("   ")).toHaveLength(3);
    expect(parseSsidFloorMap(DEFAULT_SSID_FLOOR_MAP)).toHaveLength(3);
  });

  it("lowercases the needle and preserves declaration order", () => {
    const rules = parseSsidFloorMap("AAA=floor-1,bbb=floor-2");
    expect(rules.map((r) => r.needle)).toEqual(["aaa", "bbb"]);
    expect(rules.map((r) => r.floorId)).toEqual(["floor-1", "floor-2"]);
  });

  it("drops garbage rules (no '=', empty needle, empty floor)", () => {
    const rules = parseSsidFloorMap("nofloor,=floor-1,abc=,xyz=floor-9");
    expect(rules).toEqual([{ needle: "xyz", floorId: "floor-9" }]);
  });
});

describe("DefaultSsidFloorResolver — default KALVIUM map", () => {
  const r = new DefaultSsidFloorResolver(undefined);

  it("maps the GF/1F/2F substrings to the right floors", () => {
    expect(r.ssidToFloorId("KALVIUMGF")).toBe("ground");
    expect(r.ssidToFloorId("KALVIUM1F")).toBe("floor-1");
    expect(r.ssidToFloorId("KALVIUM2F")).toBe("floor-2");
  });

  it("is case-insensitive", () => {
    expect(r.ssidToFloorId("kalviumgf")).toBe("ground");
    expect(r.ssidToFloorId("Kalvium1f")).toBe("floor-1");
    expect(r.ssidToFloorId("kAlViUm2F")).toBe("floor-2");
  });

  it("tolerates band suffixes and prefixes (substring match)", () => {
    expect(r.ssidToFloorId("Hustle@KALVIUM2F5G")).toBe("floor-2");
    expect(r.ssidToFloorId("Hustle@KALVIUM2F2.4G")).toBe("floor-2");
    expect(r.ssidToFloorId("KALVIUM1F-5GHz")).toBe("floor-1");
    expect(r.ssidToFloorId("  KALVIUMGF_guest  ")).toBe("ground");
  });

  it("returns null for unknown / empty / non-string SSIDs", () => {
    expect(r.ssidToFloorId("SomeOtherWiFi")).toBeNull();
    expect(r.ssidToFloorId("")).toBeNull();
    expect(r.ssidToFloorId("   ")).toBeNull();
    expect(r.ssidToFloorId(undefined)).toBeNull();
    expect(r.ssidToFloorId(123 as unknown as string)).toBeNull();
  });

  it("is enabled with three rules", () => {
    expect(r.enabled()).toBe(true);
    expect(r.ruleCount()).toBe(3);
  });
});

describe("DefaultSsidFloorResolver — custom map + first-match-wins", () => {
  it("honors a custom SSID_FLOOR_MAP", () => {
    const r = new DefaultSsidFloorResolver("ACME-LOBBY=ground,ACME-LAB=floor-1");
    expect(r.ssidToFloorId("ACME-LAB-5G")).toBe("floor-1");
    expect(r.ssidToFloorId("ACME-LOBBY")).toBe("ground");
    expect(r.ssidToFloorId("KALVIUM2F")).toBeNull(); // default no longer applies
  });

  it("returns the FIRST matching rule when several substrings match", () => {
    // "office" appears in both SSIDs; first declared rule wins.
    const r = new DefaultSsidFloorResolver("office=ground,office-2f=floor-2");
    expect(r.ssidToFloorId("office-2f")).toBe("ground");
  });
});

describe("DefaultSsidFloorResolver — floor validation", () => {
  it("drops rules whose floor id is not in the active building", () => {
    const r = new DefaultSsidFloorResolver(
      "KALVIUMGF=ground,KALVIUM9F=floor-9",
      ["ground", "floor-1", "floor-2"],
    );
    expect(r.ssidToFloorId("KALVIUMGF")).toBe("ground");
    expect(r.ssidToFloorId("KALVIUM9F")).toBeNull(); // floor-9 not in building
    expect(r.ruleCount()).toBe(1);
  });

  it("keeps the full default map against the real floor ids", () => {
    const r = createSsidFloorResolver(
      { SSID_FLOOR_MAP: undefined } as NodeJS.ProcessEnv,
      ["ground", "floor-1", "floor-2"],
    );
    expect(r.ruleCount()).toBe(3);
    expect(r.ssidToFloorId("KALVIUM2F")).toBe("floor-2");
  });
});
