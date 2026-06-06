// ---------------------------------------------------------------------------
// Seat-slot allocator (framework-free).
//
// Anchors for meetings and social events are picked by a numeric index. Deriving
// that index from a set's size or an array's push position is unsafe: after a
// mid-session leave the next joiner can be handed an index a still-seated person
// already occupies, stacking two avatars on one anchor tile.
//
// This allocator assigns each member the LOWEST free slot on first join,
// preserves it on re-join (idempotent), and frees it on leave/disconnect so a
// vacated slot is reused without colliding with an occupied one.
// ---------------------------------------------------------------------------

/** Stable slot assignment per key (e.g. meetingId / eventId). */
export class SlotAllocator {
  /** key -> (memberId -> slotIndex). */
  private readonly bySpace = new Map<string, Map<string, number>>();

  /**
   * Return the member's slot, allocating the lowest free index on first join.
   * Idempotent: re-joining returns the same slot.
   */
  assign(spaceId: string, memberId: string): number {
    let slots = this.bySpace.get(spaceId);
    if (!slots) {
      slots = new Map<string, number>();
      this.bySpace.set(spaceId, slots);
    }
    const existing = slots.get(memberId);
    if (existing !== undefined) return existing;

    const taken = new Set(slots.values());
    let slot = 0;
    while (taken.has(slot)) slot++;
    slots.set(memberId, slot);
    return slot;
  }

  /** Free a member's slot in one space (e.g. leave a meeting). */
  release(spaceId: string, memberId: string): void {
    const slots = this.bySpace.get(spaceId);
    if (!slots) return;
    slots.delete(memberId);
    if (slots.size === 0) this.bySpace.delete(spaceId);
  }

  /** Free a member from EVERY space (e.g. on disconnect). */
  releaseEverywhere(memberId: string): void {
    for (const [spaceId, slots] of this.bySpace) {
      if (slots.delete(memberId) && slots.size === 0) {
        this.bySpace.delete(spaceId);
      }
    }
  }

  /** Drop an entire space (e.g. a meeting/event ended). */
  clearSpace(spaceId: string): void {
    this.bySpace.delete(spaceId);
  }
}
