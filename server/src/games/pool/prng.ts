// ---------------------------------------------------------------------------
// A tiny, fast, fully-deterministic PRNG (mulberry32). Returns [0, 1).
//
// The pool physics + AI are DETERMINISTIC: they never read Math.random or a
// clock. Any randomness (the AI's aim noise) flows through an instance of this
// PRNG that the caller injects, so the same seed always produces the same game.
// ---------------------------------------------------------------------------

export type Prng = () => number;

/** Seedable mulberry32 PRNG. Same seed => identical stream. */
export function makePrng(seed: number): Prng {
  let a = seed >>> 0;
  return function (): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
