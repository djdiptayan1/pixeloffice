// ---------------------------------------------------------------------------
// Floor-location adapter tests — CIDR matching, IP normalization, env parsing,
// the Noop fallback, and enabled() logic. The adapter is pure + framework-free,
// so these are direct unit tests (no Colyseus, no network).
//
// PRIVACY note: there is nothing to assert about logging because the module
// never logs — these tests only verify the classify()/detectFloorId() math.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import {
  EnvFloorLocationAdapter,
  NoopFloorLocationAdapter,
  createFloorLocationAdapter,
  normalizeIpv4,
  parseCidrRule,
  clientIpFromRequest,
  type FloorLocationAdapter,
} from "./floor-location.adapter";

describe("normalizeIpv4", () => {
  it("passes through a plain dotted quad", () => {
    expect(normalizeIpv4("10.1.2.3")).toBe("10.1.2.3");
  });

  it("strips an IPv6-mapped IPv4 prefix (case-insensitive)", () => {
    expect(normalizeIpv4("::ffff:10.1.2.3")).toBe("10.1.2.3");
    expect(normalizeIpv4("::FFFF:192.168.0.1")).toBe("192.168.0.1");
  });

  it("takes the first hop of an x-forwarded-for chain", () => {
    expect(normalizeIpv4("10.1.2.3, 70.0.0.1, 8.8.8.8")).toBe("10.1.2.3");
  });

  it("strips a trailing :port from a dotted quad", () => {
    expect(normalizeIpv4("10.1.2.3:54321")).toBe("10.1.2.3");
  });

  it("returns null for undefined / empty / garbage / pure IPv6", () => {
    expect(normalizeIpv4(undefined)).toBeNull();
    expect(normalizeIpv4("")).toBeNull();
    expect(normalizeIpv4("   ")).toBeNull();
    expect(normalizeIpv4("not-an-ip")).toBeNull();
    expect(normalizeIpv4("999.1.1.1")).toBeNull(); // octet out of range
    expect(normalizeIpv4("10.1.2")).toBeNull(); // too few octets
    expect(normalizeIpv4("2001:db8::1")).toBeNull(); // pure IPv6 unsupported
  });
});

describe("parseCidrRule", () => {
  it("parses a valid CIDR with a floor id", () => {
    const rule = parseCidrRule("10.1.0.0/16", "floor-1");
    expect(rule).not.toBeNull();
    expect(rule!.floorId).toBe("floor-1");
  });

  it("rejects a missing prefix, bad address, or out-of-range prefix", () => {
    expect(parseCidrRule("10.1.0.0", "x")).toBeNull(); // no /prefix
    expect(parseCidrRule("999.0.0.0/8", "x")).toBeNull(); // bad address
    expect(parseCidrRule("10.0.0.0/33", "x")).toBeNull(); // prefix > 32
    expect(parseCidrRule("10.0.0.0/-1", "x")).toBeNull(); // prefix < 0
    expect(parseCidrRule("", "x")).toBeNull();
  });
});

describe("EnvFloorLocationAdapter — classify + detectFloorId", () => {
  const SUBNETS = "10.1.0.0/16=floor-1,10.2.0.0/16=floor-2,10.0.0.0/16=ground";

  it("classifies an in-range IP OFFICE and detects its floor", () => {
    const a = new EnvFloorLocationAdapter(SUBNETS, undefined);
    expect(a.classify("10.1.5.20")).toBe("OFFICE");
    expect(a.detectFloorId("10.1.5.20")).toBe("floor-1");
    expect(a.classify("10.2.99.1")).toBe("OFFICE");
    expect(a.detectFloorId("10.2.99.1")).toBe("floor-2");
    expect(a.classify("10.0.0.5")).toBe("OFFICE");
    expect(a.detectFloorId("10.0.0.5")).toBe("ground");
  });

  it("classifies an out-of-range IP REMOTE with no floor", () => {
    const a = new EnvFloorLocationAdapter(SUBNETS, undefined);
    expect(a.classify("70.10.20.30")).toBe("REMOTE");
    expect(a.detectFloorId("70.10.20.30")).toBeNull();
    expect(a.classify("11.0.0.1")).toBe("REMOTE");
  });

  it("matches the first declared subnet on overlap (declaration order wins)", () => {
    // A /24 inside a /16: declare the /24 first so it wins for its block.
    const a = new EnvFloorLocationAdapter(
      "10.1.5.0/24=floor-1b,10.1.0.0/16=floor-1",
      undefined,
    );
    expect(a.detectFloorId("10.1.5.7")).toBe("floor-1b"); // /24 wins
    expect(a.detectFloorId("10.1.9.7")).toBe("floor-1"); // outside /24, in /16
  });

  it("respects /16 vs /24 boundaries", () => {
    const a16 = new EnvFloorLocationAdapter("10.1.0.0/16=f", undefined);
    expect(a16.classify("10.1.255.255")).toBe("OFFICE"); // last /16 addr
    expect(a16.classify("10.2.0.0")).toBe("REMOTE"); // just past /16

    const a24 = new EnvFloorLocationAdapter("10.1.5.0/24=f", undefined);
    expect(a24.classify("10.1.5.255")).toBe("OFFICE"); // last /24 addr
    expect(a24.classify("10.1.6.0")).toBe("REMOTE"); // just past /24
    expect(a24.classify("10.1.4.255")).toBe("REMOTE"); // just before /24
  });

  it("handles IPv6-mapped IPv4 and x-forwarded-for input", () => {
    const a = new EnvFloorLocationAdapter(SUBNETS, undefined);
    expect(a.classify("::ffff:10.1.2.3")).toBe("OFFICE");
    expect(a.detectFloorId("::ffff:10.1.2.3")).toBe("floor-1");
    expect(a.detectFloorId("10.2.0.9, 8.8.8.8")).toBe("floor-2");
  });

  it("treats undefined / garbage as REMOTE / null", () => {
    const a = new EnvFloorLocationAdapter(SUBNETS, undefined);
    expect(a.classify(undefined)).toBe("REMOTE");
    expect(a.detectFloorId(undefined)).toBeNull();
    expect(a.classify("garbage")).toBe("REMOTE");
    expect(a.detectFloorId("garbage")).toBeNull();
  });

  it("OFFICE_CIDRS classify OFFICE but detect no specific floor", () => {
    const a = new EnvFloorLocationAdapter("10.1.0.0/16=floor-1", "203.0.113.0/24");
    expect(a.classify("203.0.113.45")).toBe("OFFICE");
    expect(a.detectFloorId("203.0.113.45")).toBeNull(); // floor-less office range
    // The floor-bearing subnet still resolves a floor.
    expect(a.detectFloorId("10.1.0.9")).toBe("floor-1");
  });

  it("drops invalid env pairs but keeps the valid ones", () => {
    const a = new EnvFloorLocationAdapter(
      "garbage,10.1.0.0/16=floor-1,10.2.0.0=missing-prefix,10.3.0.0/16=",
      undefined,
    );
    expect(a.enabled()).toBe(true);
    expect(a.detectFloorId("10.1.0.5")).toBe("floor-1");
    expect(a.classify("10.2.0.5")).toBe("REMOTE"); // missing-prefix pair dropped
    expect(a.classify("10.3.0.5")).toBe("REMOTE"); // empty floor id dropped
  });

  it("enabled() is true with rules and false with none", () => {
    expect(new EnvFloorLocationAdapter(SUBNETS, undefined).enabled()).toBe(true);
    expect(new EnvFloorLocationAdapter("203.0.113.0/24=", "203.0.113.0/24").enabled()).toBe(true);
    expect(new EnvFloorLocationAdapter("garbage", "alsogarbage").enabled()).toBe(false);
    expect(new EnvFloorLocationAdapter(undefined, undefined).enabled()).toBe(false);
  });
});

describe("NoopFloorLocationAdapter", () => {
  it("classifies everyone REMOTE / null and is disabled", () => {
    const a: FloorLocationAdapter = new NoopFloorLocationAdapter();
    expect(a.classify("10.1.2.3")).toBe("REMOTE");
    expect(a.detectFloorId("10.1.2.3")).toBeNull();
    expect(a.enabled()).toBe(false);
  });
});

describe("createFloorLocationAdapter (env factory)", () => {
  it("returns Noop when no env is configured (zero-config default)", () => {
    const a = createFloorLocationAdapter({} as NodeJS.ProcessEnv);
    expect(a).toBeInstanceOf(NoopFloorLocationAdapter);
    expect(a.enabled()).toBe(false);
  });

  it("returns Noop when env is set but nothing parses", () => {
    const a = createFloorLocationAdapter({ OFFICE_SUBNETS: "junk" } as NodeJS.ProcessEnv);
    expect(a.enabled()).toBe(false);
  });

  it("returns an enabled Env adapter when OFFICE_SUBNETS parses", () => {
    const a = createFloorLocationAdapter({
      OFFICE_SUBNETS: "10.1.0.0/16=floor-1",
    } as NodeJS.ProcessEnv);
    expect(a).toBeInstanceOf(EnvFloorLocationAdapter);
    expect(a.enabled()).toBe(true);
    expect(a.detectFloorId("10.1.2.3")).toBe("floor-1");
  });

  it("returns an enabled Env adapter when only OFFICE_CIDRS parses", () => {
    const a = createFloorLocationAdapter({
      OFFICE_CIDRS: "203.0.113.0/24",
    } as NodeJS.ProcessEnv);
    expect(a.enabled()).toBe(true);
    expect(a.classify("203.0.113.5")).toBe("OFFICE");
    expect(a.detectFloorId("203.0.113.5")).toBeNull();
  });
});

describe("clientIpFromRequest", () => {
  it("uses the socket peer when trustProxy is false (ignores XFF)", () => {
    const ip = clientIpFromRequest(
      { "x-forwarded-for": "1.2.3.4" },
      "10.0.0.9",
      false,
    );
    expect(ip).toBe("10.0.0.9");
  });

  it("honors the first XFF hop when trustProxy is true", () => {
    const ip = clientIpFromRequest(
      { "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
      "10.0.0.9",
      true,
    );
    expect(ip).toBe("1.2.3.4");
  });

  it("falls back to the socket peer when XFF is absent even if trusted", () => {
    expect(clientIpFromRequest({}, "10.0.0.9", true)).toBe("10.0.0.9");
    expect(clientIpFromRequest(undefined, "10.0.0.9", true)).toBe("10.0.0.9");
  });

  it("returns undefined when no IP can be resolved", () => {
    expect(clientIpFromRequest(undefined, undefined, false)).toBeUndefined();
  });
});
