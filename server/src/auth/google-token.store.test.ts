import { describe, expect, it } from "vitest";
import { InMemoryGoogleTokenStore } from "./google-token.store";

describe("InMemoryGoogleTokenStore", () => {
  it("round-trips a record and lists connected users", () => {
    const store = new InMemoryGoogleTokenStore();
    expect(store.get("u1")).toBeNull();
    expect(store.connectedUserIds()).toEqual([]);

    store.save("u1", { refreshToken: "RT1", scope: "cal", email: "a@b.com" });
    const rec = store.get("u1");
    expect(rec?.refreshToken).toBe("RT1");
    expect(rec?.scope).toBe("cal");
    expect(typeof rec?.connectedAtMs).toBe("number");
    expect(store.connectedUserIds()).toEqual(["u1"]);
  });

  it("overwrites an existing grant on re-save", () => {
    const store = new InMemoryGoogleTokenStore();
    store.save("u1", { refreshToken: "old" });
    store.save("u1", { refreshToken: "new" });
    expect(store.get("u1")?.refreshToken).toBe("new");
    expect(store.connectedUserIds()).toEqual(["u1"]);
  });

  it("deletes a grant (disconnect)", () => {
    const store = new InMemoryGoogleTokenStore();
    store.save("u1", { refreshToken: "RT" });
    store.delete("u1");
    expect(store.get("u1")).toBeNull();
    expect(store.connectedUserIds()).toEqual([]);
  });

  it("preserves an explicitly supplied connectedAtMs", () => {
    const store = new InMemoryGoogleTokenStore();
    store.save("u1", { refreshToken: "RT", connectedAtMs: 123 });
    expect(store.get("u1")?.connectedAtMs).toBe(123);
  });
});
