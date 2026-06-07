import { describe, expect, it, vi } from "vitest";
import { GreytHrEssAttendanceAdapter } from "./greythr-ess-attendance.adapter";
import { InMemoryGreytHrSessionStore } from "../../auth/greythr/greythr-session.store";

const BASE = "https://greythr.example.com";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** A session store pre-seeded with one user -> session id. */
function storeWith(userId: string, sessionId: string): InMemoryGreytHrSessionStore {
  const s = new InMemoryGreytHrSessionStore();
  s.set(userId, sessionId);
  return s;
}

describe("GreytHrEssAttendanceAdapter — construction", () => {
  it("throws without a baseUrl", () => {
    expect(
      () =>
        new GreytHrEssAttendanceAdapter({
          baseUrl: "",
          sessions: new InMemoryGreytHrSessionStore(),
        }),
    ).toThrow();
  });
});

describe("GreytHrEssAttendanceAdapter — check-in / check-out", () => {
  it("posts sign-in with the user's Bearer session and returns greytHR's swipe time", async () => {
    const sessions = storeWith("greythr:KCC001", "sess-abc");
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe(`${BASE}/api/attendance/sign-in`);
      expect(init?.method).toBe("POST");
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer sess-abc");
      return jsonResponse({
        success: true,
        data: { ok: true, status: "CHECKED_IN", recordedAtMs: 1_700_000_000_000 },
        error: null,
      });
    }) as unknown as typeof fetch;

    const a = new GreytHrEssAttendanceAdapter({ baseUrl: `${BASE}/`, sessions, fetchFn });
    const result = await a.checkIn("greythr:KCC001", 999);

    expect(result.ok).toBe(true);
    expect(result.status).toBe("CHECKED_IN");
    expect(result.recordedAtMs).toBe(1_700_000_000_000); // greytHR's time, not the caller's
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("posts sign-out and maps the status", async () => {
    const sessions = storeWith("u1", "s1");
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toBe(`${BASE}/api/attendance/sign-out`);
      return jsonResponse({
        success: true,
        data: { ok: true, status: "CHECKED_OUT", recordedAtMs: 42 },
        error: null,
      });
    }) as unknown as typeof fetch;

    const a = new GreytHrEssAttendanceAdapter({ baseUrl: BASE, sessions, fetchFn });
    const result = await a.checkOut("u1", 7);
    expect(result.ok).toBe(true);
    expect(result.status).toBe("CHECKED_OUT");
    expect(result.recordedAtMs).toBe(42);
  });

  it("returns ok:false (never throws, never calls fetch) when the user has no greytHR session", async () => {
    const fetchFn = vi.fn() as unknown as typeof fetch;
    const a = new GreytHrEssAttendanceAdapter({
      baseUrl: BASE,
      sessions: new InMemoryGreytHrSessionStore(),
      fetchFn,
    });
    const result = await a.checkIn("dev:nobody", 123);
    expect(result.ok).toBe(false);
    expect(result.status).toBe("CHECKED_IN");
    expect(result.recordedAtMs).toBe(123); // falls back to the caller's clock
    expect(result.reason).toMatch(/sign in/i);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("drops the session and degrades on a 401 (expired session)", async () => {
    const sessions = storeWith("u1", "stale");
    const fetchFn = vi.fn(async () =>
      jsonResponse(
        { success: false, data: null, error: { code: "UNAUTHORIZED", message: "expired" } },
        401,
      ),
    ) as unknown as typeof fetch;

    const a = new GreytHrEssAttendanceAdapter({ baseUrl: BASE, sessions, fetchFn });
    const result = await a.checkIn("u1", 5);

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/expired/i);
    // The dead session is removed so the user is prompted to sign in again.
    expect(sessions.get("u1")).toBeNull();
  });

  it("degrades gracefully on a network error (returns ok:false, does not throw)", async () => {
    const sessions = storeWith("u1", "s1");
    const fetchFn = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;

    const a = new GreytHrEssAttendanceAdapter({ baseUrl: BASE, sessions, fetchFn });
    const result = await a.checkOut("u1", 5);
    expect(result.ok).toBe(false);
    expect(result.status).toBe("CHECKED_OUT");
    expect(result.reason).toMatch(/network/i);
  });

  it("lookupEmployee/syncDepartments degrade to null/[] (not part of the swipe path)", async () => {
    const a = new GreytHrEssAttendanceAdapter({
      baseUrl: BASE,
      sessions: new InMemoryGreytHrSessionStore(),
    });
    expect(await a.lookupEmployee("x@y.com")).toBeNull();
    expect(await a.syncDepartments()).toEqual([]);
  });
});
