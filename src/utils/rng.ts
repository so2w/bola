/** Seeded RNG for deterministic domain logic (AGENTS.md §28: no Math.random in domain). */

export type Rng = () => number; // uniform in [0, 1)

/**
 * mulberry32 — small, fast, deterministic PRNG.
 * All operations are 32-bit integer ops (Math.imul), so results are identical
 * across JS engines and platforms.
 */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
