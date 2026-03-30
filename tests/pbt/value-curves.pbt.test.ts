import { describe, expect, it } from 'bun:test';
import { mapValueClamped, mapValueExponential, mapValueLogClamped, mapValueSCurve } from '@domain/value-curves';
import fc from 'fast-check';

// Arbitraries
const midiValue = fc.integer({ min: 0, max: 127 });
const anyNumber = fc.double({ min: -1000, max: 1000, noNaN: true });
const validRange = fc
  .tuple(fc.double({ min: -1000, max: 1000, noNaN: true }), fc.double({ min: -1000, max: 1000, noNaN: true }))
  .filter(([a, b]) => a < b);

describe('PBT: Value Curves', () => {
  for (const [name, fn] of [
    ['mapValueClamped', mapValueClamped],
    ['mapValueExponential', mapValueExponential],
    ['mapValueSCurve', mapValueSCurve],
  ] as const) {
    describe(name, () => {
      it('output is always within target range (clamping)', () => {
        fc.assert(
          fc.property(anyNumber, validRange, validRange, (value, from, to) => {
            const result = fn(value, from, to);
            const min = Math.min(to[0], to[1]);
            const max = Math.max(to[0], to[1]);
            expect(result).toBeGreaterThanOrEqual(min - 0.0001);
            expect(result).toBeLessThanOrEqual(max + 0.0001);
          }),
        );
      });

      it('returns to[0] at from[0] input', () => {
        fc.assert(
          fc.property(validRange, validRange, (from, to) => {
            expect(fn(from[0], from, to)).toBeCloseTo(to[0], 5);
          }),
        );
      });

      it('returns to[1] at from[1] input', () => {
        fc.assert(
          fc.property(validRange, validRange, (from, to) => {
            expect(fn(from[1], from, to)).toBeCloseTo(to[1], 5);
          }),
        );
      });
    });
  }

  describe('mapValueClamped monotonicity', () => {
    it('is monotonically non-decreasing for non-inverted target range', () => {
      fc.assert(
        fc.property(anyNumber, anyNumber, validRange, validRange, (v1, v2, from, to) => {
          if (to[0] <= to[1]) {
            const r1 = mapValueClamped(Math.min(v1, v2), from, to);
            const r2 = mapValueClamped(Math.max(v1, v2), from, to);
            expect(r1).toBeLessThanOrEqual(r2 + 0.0001);
          }
        }),
      );
    });
  });

  describe('mapValueLogClamped', () => {
    it('falls back to linear when target range crosses zero', () => {
      fc.assert(
        fc.property(
          anyNumber,
          validRange,
          fc.tuple(fc.double({ min: -100, max: 0, noNaN: true }), fc.double({ min: 0, max: 100, noNaN: true })),
          (value, from, to) => {
            const logResult = mapValueLogClamped(value, from, to);
            const linResult = mapValueClamped(value, from, to);
            expect(logResult).toBeCloseTo(linResult, 5);
          },
        ),
      );
    });
  });
});
