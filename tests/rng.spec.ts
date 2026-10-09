import { describe, it, expect } from 'vitest';
import { mulberry32 } from '../src/utils/rng';

describe('mulberry32 rng', () => {
  it('produces known fixed-seed vectors (determinism across engines)', () => {
    const rng = mulberry32(42);
    const values = [rng(), rng(), rng(), rng(), rng()];
    // Reference vectors for mulberry32(seed=42)
    expect(values[0]).toBeCloseTo(0.6011037519, 9);
    // Pinned from the canonical implementation (first vector matches the
    // published mulberry32 reference, so the algorithm is canonical).
    expect(values[1]).toBeCloseTo(0.448290559, 9);
  });

  it('two instances with the same seed produce identical streams', () => {
    const a = mulberry32(123);
    const b = mulberry32(123);
    for (let i = 0; i < 100; i++) {
      expect(a()).toBe(b());
    }
  });

  it('different seeds produce different streams', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    const streamA = Array.from({ length: 10 }, () => a());
    const streamB = Array.from({ length: 10 }, () => b());
    expect(streamA).not.toEqual(streamB);
  });

  it('outputs stay within [0, 1)', () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
