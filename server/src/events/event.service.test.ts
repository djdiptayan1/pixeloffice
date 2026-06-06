import { beforeEach, describe, expect, it } from "vitest";
import { EventService } from "./event.service";
import type { SocialEvent } from "@pixeloffice/shared";

const NOW = 1_000_000;
const MIN = 60_000;

function makeEvent(svc: EventService): SocialEvent {
  // 10-minute coffee break starting now.
  return svc.createEvent("COFFEE_BREAK", "Coffee", 10, NOW);
}

describe("EventService — create + activeEvents", () => {
  it("emits 'created' once and exposes the event while active", () => {
    const svc = new EventService();
    const created: SocialEvent[] = [];
    svc.on("created", (e) => created.push(e));
    const e = makeEvent(svc);
    expect(created).toEqual([e]);
    expect(svc.activeEvents(NOW).map((x) => x.id)).toEqual([e.id]);
    // Past its endTime it is no longer active.
    expect(svc.activeEvents(e.endTime)).toEqual([]);
  });

  it("derives a deterministic id from the injected clock (not Date.now)", () => {
    const svc = new EventService();
    const e = svc.createEvent("TEA_BREAK", "Tea", 5, 4242);
    expect(e.id.startsWith("event_4242_")).toBe(true);
  });
});

describe("EventService — join / leave / re-join slot stability", () => {
  let svc: EventService;
  let e: SocialEvent;

  beforeEach(() => {
    svc = new EventService();
    e = makeEvent(svc);
  });

  it("join is idempotent: re-joining returns the SAME slot and emits 'updated' once", () => {
    const updates: SocialEvent[] = [];
    svc.on("updated", (ev) => updates.push(ev));
    const first = svc.join(e.id, "A", NOW);
    const again = svc.join(e.id, "A", NOW);
    expect(first?.anchorIndex).toBe(0);
    expect(again?.anchorIndex).toBe(0);
    expect(updates.length).toBe(1); // only the first join changed membership
  });

  it("reuses a vacated slot WITHOUT colliding with a still-seated occupant", () => {
    // The core anchor-collision bug: A,B,C -> 0,1,2; B leaves; D must NOT get 2.
    expect(svc.join(e.id, "A", NOW)?.anchorIndex).toBe(0);
    expect(svc.join(e.id, "B", NOW)?.anchorIndex).toBe(1);
    expect(svc.join(e.id, "C", NOW)?.anchorIndex).toBe(2);
    svc.leave(e.id, "B");
    const d = svc.join(e.id, "D", NOW);
    expect(d?.anchorIndex).toBe(1); // the freed slot, not C's slot (2)
    // C still occupies its original slot.
    expect(svc.join(e.id, "C", NOW)?.anchorIndex).toBe(2);
  });

  it("leaving a non-member is a no-op", () => {
    const updates: SocialEvent[] = [];
    svc.on("updated", (ev) => updates.push(ev));
    svc.leave(e.id, "ghost");
    expect(updates).toEqual([]);
  });
});

describe("EventService — expiry guard on join", () => {
  it("join returns null for an expired-but-not-yet-swept event", () => {
    const svc = new EventService();
    const e = makeEvent(svc);
    expect(svc.join(e.id, "A", e.endTime)).toBeNull();
    expect(svc.join(e.id, "A", e.endTime + 1)).toBeNull();
    // still joinable just before end
    expect(svc.join(e.id, "A", e.endTime - 1)?.anchorIndex).toBe(0);
  });

  it("join returns null for an unknown event id", () => {
    const svc = new EventService();
    expect(svc.join("nope", "A", NOW)).toBeNull();
  });
});

describe("EventService — removeParticipant (disconnect)", () => {
  it("drops the session from every joined event and frees its slot", () => {
    const svc = new EventService();
    const e1 = svc.createEvent("COFFEE_BREAK", "C", 10, NOW);
    const e2 = svc.createEvent("TOWN_HALL", "T", 10, NOW);
    svc.join(e1.id, "A", NOW);
    svc.join(e1.id, "B", NOW);
    svc.join(e2.id, "B", NOW);
    svc.removeParticipant("B");
    expect(svc.isInActiveEvent("B", NOW)).toBe(false);
    // B's slot in e1 is freed, so the next joiner reuses it (1, not 2).
    expect(svc.join(e1.id, "C", NOW)?.anchorIndex).toBe(1);
  });
});

describe("EventService — isInActiveEvent + tick expiry", () => {
  it("isInActiveEvent is false after endTime even while still a participant", () => {
    const svc = new EventService();
    const e = makeEvent(svc);
    svc.join(e.id, "A", NOW);
    expect(svc.isInActiveEvent("A", NOW)).toBe(true);
    expect(svc.isInActiveEvent("A", e.endTime)).toBe(false);
  });

  it("tick emits 'ended' once per expired event and deletes it (idempotent)", () => {
    const svc = new EventService();
    const e = makeEvent(svc);
    const ended: string[] = [];
    svc.on("ended", (id: string) => ended.push(id));
    svc.tick(NOW + 5 * MIN); // not yet expired
    expect(ended).toEqual([]);
    svc.tick(e.endTime); // now expired
    expect(ended).toEqual([e.id]);
    svc.tick(e.endTime + MIN); // already gone -> nothing
    expect(ended).toEqual([e.id]);
    expect(svc.getEvent(e.id)).toBeNull();
  });
});
