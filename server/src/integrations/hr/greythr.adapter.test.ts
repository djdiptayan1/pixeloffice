import { describe, expect, it, vi } from "vitest";
import { GreytHrAdapter } from "./greythr.adapter";
import { HrAdapterError } from "./hr-adapter";

// Credential config => the adapter acquires a token via /uas/v1/oauth2/client-token.
const CFG = {
  baseUrl: "https://kalvium.greythr.com/",
  apiUser: "Apiuser",
  apiKey: "secret-key",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function tokenResponse(token = "tok-1", expiresInSec = 3600): Response {
  return jsonResponse({ access_token: token, token_type: "Bearer", expires_in: expiresInSec });
}

/** A controllable clock for token-expiry assertions. */
function fakeClock(start = 1_000_000): { now: () => number; advance: (ms: number) => void } {
  let t = start;
  return { now: () => t, advance: (ms) => (t += ms) };
}

describe("GreytHrAdapter — construction", () => {
  it("throws a config error with no baseUrl and no credentials/token", () => {
    expect(() => new GreytHrAdapter({ baseUrl: "" })).toThrow(HrAdapterError);
  });

  it("accepts a legacy pre-acquired apiToken (no api user/key)", () => {
    expect(
      () => new GreytHrAdapter({ baseUrl: "https://x.greythr.com", apiToken: "pre" }),
    ).not.toThrow();
  });
});

describe("GreytHrAdapter — token acquisition, caching & refresh", () => {
  it("acquires a token once and reuses it across calls (caching)", async () => {
    const clock = fakeClock();
    let tokenCalls = 0;
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes("/uas/v1/oauth2/client-token")) {
        tokenCalls += 1;
        return tokenResponse("tok-1", 3600);
      }
      return jsonResponse({ data: [{ id: "e1", email: "a@x.com", name: "A", department: "HR" }] });
    }) as unknown as typeof fetch;

    const a = new GreytHrAdapter({ ...CFG, fetchFn, now: clock.now });
    await a.lookupEmployee("a@x.com");
    await a.lookupEmployee("a@x.com");
    expect(tokenCalls).toBe(1); // cached — only one token fetch
  });

  it("posts client_credentials and the x-greythr-domain header to the token endpoint", async () => {
    let seenInit: RequestInit | undefined;
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes("/uas/v1/oauth2/client-token")) {
        seenInit = init;
        return tokenResponse();
      }
      return jsonResponse({ data: [] });
    }) as unknown as typeof fetch;

    const a = new GreytHrAdapter({ ...CFG, fetchFn });
    await a.lookupEmployee("a@x.com");
    const headers = seenInit?.headers as Record<string, string>;
    expect(headers["x-greythr-domain"]).toBe("kalvium.greythr.com");
    const body = JSON.parse(String(seenInit?.body));
    expect(body).toMatchObject({
      grant_type: "client_credentials",
      client_id: "Apiuser",
      client_secret: "secret-key",
    });
  });

  it("refreshes the token after it expires (refresh-before-expiry skew)", async () => {
    const clock = fakeClock();
    let tokenCalls = 0;
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes("/uas/v1/oauth2/client-token")) {
        tokenCalls += 1;
        return tokenResponse(`tok-${tokenCalls}`, 60); // 60s lifetime
      }
      return jsonResponse({ data: [] });
    }) as unknown as typeof fetch;

    const a = new GreytHrAdapter({ ...CFG, fetchFn, now: clock.now });
    await a.lookupEmployee("a@x.com");
    expect(tokenCalls).toBe(1);
    // Past 60s (minus 30s skew => refresh after 30s); advance well beyond.
    clock.advance(60_000);
    await a.lookupEmployee("a@x.com");
    expect(tokenCalls).toBe(2); // refreshed
  });

  it("sends the access token in the ACCESS-TOKEN header (not Authorization)", async () => {
    let apiInit: RequestInit | undefined;
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes("/uas/v1/oauth2/client-token")) return tokenResponse("tok-Z");
      apiInit = init;
      return jsonResponse({ data: [] });
    }) as unknown as typeof fetch;

    const a = new GreytHrAdapter({ ...CFG, fetchFn });
    await a.lookupEmployee("a@x.com");
    const headers = apiInit?.headers as Record<string, string>;
    expect(headers["Access-Token"]).toBe("tok-Z");
    expect(headers["x-greythr-domain"]).toBe("kalvium.greythr.com");
    expect(headers.Authorization).toBeUndefined();
  });

  it("uses a pre-acquired apiToken directly without calling the token endpoint", async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).not.toContain("/uas/v1/oauth2/client-token");
      expect((init?.headers as Record<string, string>)["Access-Token"]).toBe("pre-tok");
      return jsonResponse({ data: [] });
    }) as unknown as typeof fetch;

    const a = new GreytHrAdapter({ baseUrl: CFG.baseUrl, apiToken: "pre-tok", fetchFn });
    await a.lookupEmployee("a@x.com");
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

describe("GreytHrAdapter — lookupEmployee", () => {
  it("queries the lookup endpoint and maps a {data:[...]} response", async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes("/uas/v1/oauth2/client-token")) return tokenResponse();
      expect(u).toContain("/employee/v2/employees/lookup?q=ada%40x.com");
      return jsonResponse({
        data: [{ id: "e1", email: "ada@x.com", fullName: "Ada", departmentName: "Engineering" }],
      });
    }) as unknown as typeof fetch;

    const a = new GreytHrAdapter({ ...CFG, fetchFn });
    const rec = await a.lookupEmployee("ada@x.com");
    expect(rec).toEqual({ id: "e1", email: "ada@x.com", name: "Ada", department: "Engineering" });
  });

  it("returns null for empty email without any fetch", async () => {
    const fetchFn = vi.fn() as unknown as typeof fetch;
    const a = new GreytHrAdapter({ ...CFG, fetchFn });
    expect(await a.lookupEmployee("  ")).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe("GreytHrAdapter — syncDepartments", () => {
  it("maps labels onto office departments (aliases + null)", async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes("/uas/v1/oauth2/client-token")) return tokenResponse();
      return jsonResponse({
        data: [{ name: "Software Engineering" }, { name: "Finance" }, { name: "HR" }],
      });
    }) as unknown as typeof fetch;
    const a = new GreytHrAdapter({ ...CFG, fetchFn });
    const map = await a.syncDepartments();
    expect(map).toEqual([
      { hrDepartment: "Software Engineering", officeDepartment: "Engineering" },
      { hrDepartment: "Finance", officeDepartment: null },
      { hrDepartment: "HR", officeDepartment: "HR" },
    ]);
  });
});

describe("GreytHrAdapter — attendance swipes", () => {
  it("checkIn posts a swipe (1=in) to the ASCA endpoint and returns CHECKED_IN", async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/uas/v1/oauth2/client-token")) return tokenResponse();
      expect(u).toContain("/v2/attendance/asca/swipes");
      const body = JSON.parse(String(init?.body));
      expect(Array.isArray(body.data)).toBe(true);
      const [entry] = body.data as string[];
      expect(entry).toContain("e1");
      expect(entry.endsWith(",1")).toBe(true); // in
      return new Response("", { status: 200 });
    }) as unknown as typeof fetch;
    const a = new GreytHrAdapter({ ...CFG, fetchFn });
    const r = await a.checkIn("e1", 1700000000000);
    expect(r).toEqual({ ok: true, recordedAtMs: 1700000000000, status: "CHECKED_IN" });
  });

  it("checkOut posts a swipe (0=out) and returns CHECKED_OUT", async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes("/uas/v1/oauth2/client-token")) return tokenResponse();
      const body = JSON.parse(String(init?.body));
      expect((body.data as string[])[0].endsWith(",0")).toBe(true); // out
      return new Response("", { status: 200 });
    }) as unknown as typeof fetch;
    const a = new GreytHrAdapter({ ...CFG, fetchFn });
    const r = await a.checkOut("e1", 42);
    expect(r).toEqual({ ok: true, recordedAtMs: 42, status: "CHECKED_OUT" });
  });
});

describe("GreytHrAdapter — error mapping & graceful failure", () => {
  it("maps an aborted request to a timeout HrAdapterError", async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes("/uas/v1/oauth2/client-token")) return tokenResponse();
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    }) as unknown as typeof fetch;
    const a = new GreytHrAdapter({ ...CFG, fetchFn, timeoutMs: 5 });
    await expect(a.lookupEmployee("x@y.com")).rejects.toMatchObject({ kind: "timeout" });
  });

  it("maps a generic fetch throw to a network HrAdapterError", async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes("/uas/v1/oauth2/client-token")) return tokenResponse();
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const a = new GreytHrAdapter({ ...CFG, fetchFn });
    await expect(a.syncDepartments()).rejects.toMatchObject({ kind: "network" });
  });

  it("maps HTTP non-2xx to an http HrAdapterError", async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes("/uas/v1/oauth2/client-token")) return tokenResponse();
      return new Response("nope", { status: 500 });
    }) as unknown as typeof fetch;
    const a = new GreytHrAdapter({ ...CFG, fetchFn });
    await expect(a.checkOut("e1", 1)).rejects.toMatchObject({ kind: "http", status: 500 });
  });
});

describe("GreytHrAdapter — 401 token-refresh retry", () => {
  it("on a 401 refreshes the token ONCE then retries successfully", async () => {
    let tokenCalls = 0;
    let apiCalls = 0;
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes("/uas/v1/oauth2/client-token")) {
        tokenCalls += 1;
        return tokenResponse(`tok-${tokenCalls}`);
      }
      apiCalls += 1;
      // First API call (with tok-1) => 401; second (with tok-2) => 200.
      const headers = init?.headers as Record<string, string>;
      if (headers["Access-Token"] === "tok-1") return new Response("", { status: 401 });
      return jsonResponse({ data: [{ id: "e1", email: "a@x.com", name: "A", department: "HR" }] });
    }) as unknown as typeof fetch;

    const a = new GreytHrAdapter({ ...CFG, fetchFn });
    const rec = await a.lookupEmployee("a@x.com");
    expect(rec?.id).toBe("e1");
    expect(tokenCalls).toBe(2); // initial + one refresh
    expect(apiCalls).toBe(2); // original + retry
  });

  it("on a persistent 401 refreshes once then surfaces an http error (graceful)", async () => {
    let tokenCalls = 0;
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes("/uas/v1/oauth2/client-token")) {
        tokenCalls += 1;
        return tokenResponse(`tok-${tokenCalls}`);
      }
      return new Response("", { status: 401 }); // always 401
    }) as unknown as typeof fetch;

    const a = new GreytHrAdapter({ ...CFG, fetchFn });
    await expect(a.lookupEmployee("a@x.com")).rejects.toMatchObject({ kind: "http", status: 401 });
    expect(tokenCalls).toBe(2); // exactly one refresh, no infinite loop
  });

  it("does NOT retry-refresh when using a static pre-acquired token", async () => {
    let apiCalls = 0;
    const fetchFn = vi.fn(async () => {
      apiCalls += 1;
      return new Response("", { status: 401 });
    }) as unknown as typeof fetch;
    const a = new GreytHrAdapter({ baseUrl: CFG.baseUrl, apiToken: "pre", fetchFn });
    await expect(a.lookupEmployee("a@x.com")).rejects.toMatchObject({ kind: "http", status: 401 });
    expect(apiCalls).toBe(1); // no refresh path for static tokens
  });
});
