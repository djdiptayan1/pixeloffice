import { describe, expect, it } from "vitest";
import { SlotAllocator } from "./slot-allocator";

describe("SlotAllocator", () => {
  it("assigns 0,1,2... and is idempotent per member", () => {
    const a = new SlotAllocator();
    expect(a.assign("room", "A")).toBe(0);
    expect(a.assign("room", "B")).toBe(1);
    expect(a.assign("room", "C")).toBe(2);
    expect(a.assign("room", "A")).toBe(0); // idempotent
  });

  it("reuses the LOWEST freed slot without colliding with an occupant", () => {
    const a = new SlotAllocator();
    a.assign("room", "A"); // 0
    a.assign("room", "B"); // 1
    a.assign("room", "C"); // 2
    a.release("room", "B"); // frees slot 1
    expect(a.assign("room", "D")).toBe(1); // the freed slot
    expect(a.assign("room", "C")).toBe(2); // C keeps its slot
  });

  it("isolates slots per space", () => {
    const a = new SlotAllocator();
    expect(a.assign("m1", "A")).toBe(0);
    expect(a.assign("m2", "A")).toBe(0); // independent space
  });

  it("releaseEverywhere frees a member from all spaces", () => {
    const a = new SlotAllocator();
    a.assign("m1", "A");
    a.assign("m2", "A");
    a.releaseEverywhere("A");
    expect(a.assign("m1", "B")).toBe(0); // A's slot was freed
    expect(a.assign("m2", "B")).toBe(0);
  });

  it("clearSpace drops the whole space", () => {
    const a = new SlotAllocator();
    a.assign("m1", "A");
    a.assign("m1", "B");
    a.clearSpace("m1");
    expect(a.assign("m1", "C")).toBe(0);
  });
});
