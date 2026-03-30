import { describe, it, expect } from "bun:test";
import {
  mapValueClamped,
  mapValueClampedCurried,
  mapValueLogClamped,
  mapValueLogClampedCurried,
  mapValueExponential,
  mapValueExponentialCurried,
  mapValueSCurve,
  mapValueSCurveCurried,
} from "@domain/value-curves";

// ---------------------------------------------------------------------------
// mapValueClamped
// ---------------------------------------------------------------------------
describe("mapValueClamped", () => {
  // --- Normal cases ---
  describe("normal linear interpolation", () => {
    it("maps midpoint correctly", () => {
      expect(mapValueClamped(50, [0, 100], [0, 1])).toBeCloseTo(0.5);
    });

    it("maps quarter point correctly", () => {
      expect(mapValueClamped(25, [0, 100], [0, 1])).toBeCloseTo(0.25);
    });

    it("maps three-quarter point correctly", () => {
      expect(mapValueClamped(75, [0, 100], [0, 200])).toBeCloseTo(150);
    });

    it("maps between arbitrary ranges", () => {
      expect(mapValueClamped(15, [10, 20], [100, 200])).toBeCloseTo(150);
    });

    it("maps with negative source range", () => {
      expect(mapValueClamped(0, [-10, 10], [0, 100])).toBeCloseTo(50);
    });

    it("maps with negative target range", () => {
      expect(mapValueClamped(50, [0, 100], [-50, 50])).toBeCloseTo(0);
    });
  });

  // --- Boundary cases ---
  describe("boundary values", () => {
    it("returns to[0] when value equals from[0]", () => {
      expect(mapValueClamped(0, [0, 127], [0, 1])).toBe(0);
    });

    it("returns to[1] when value equals from[1]", () => {
      expect(mapValueClamped(127, [0, 127], [0, 1])).toBe(1);
    });

    it("returns to[0] at lower boundary with non-zero start", () => {
      expect(mapValueClamped(10, [10, 20], [100, 200])).toBe(100);
    });

    it("returns to[1] at upper boundary with non-zero start", () => {
      expect(mapValueClamped(20, [10, 20], [100, 200])).toBe(200);
    });
  });

  // --- Clamping ---
  describe("clamping", () => {
    it("clamps below minimum to to[0]", () => {
      expect(mapValueClamped(-10, [0, 100], [0, 1])).toBe(0);
    });

    it("clamps above maximum to to[1]", () => {
      expect(mapValueClamped(200, [0, 100], [0, 1])).toBe(1);
    });

    it("clamps far below minimum", () => {
      expect(mapValueClamped(-1000, [0, 127], [20, 20000])).toBe(20);
    });

    it("clamps far above maximum", () => {
      expect(mapValueClamped(9999, [0, 127], [20, 20000])).toBe(20000);
    });
  });

  // --- Degenerate range ---
  // When from[0] === from[1], the midpoint branch (c+d)/2 is unreachable:
  // value <= a is always true when value <= from[0], returning c
  // value >= b catches everything else, returning d
  describe("degenerate range (from[0] === from[1])", () => {
    it("returns c when value equals the degenerate point (value <= a)", () => {
      expect(mapValueClamped(5, [5, 5], [0, 100])).toBe(0);
    });

    it("returns c when value is below the degenerate point", () => {
      expect(mapValueClamped(3, [5, 5], [0, 100])).toBe(0);
    });

    it("returns d when value is above the degenerate point", () => {
      expect(mapValueClamped(7, [5, 5], [0, 100])).toBe(100);
    });

    it("returns c with non-zero target start", () => {
      expect(mapValueClamped(5, [5, 5], [10, 90])).toBe(10);
    });
  });

  // --- Inverse ranges ---
  describe("inverse ranges (to[0] > to[1])", () => {
    it("maps midpoint correctly with inverted target", () => {
      expect(mapValueClamped(50, [0, 100], [100, 0])).toBeCloseTo(50);
    });

    it("maps lower bound to to[0] (higher value)", () => {
      expect(mapValueClamped(0, [0, 100], [100, 0])).toBe(100);
    });

    it("maps upper bound to to[1] (lower value)", () => {
      expect(mapValueClamped(100, [0, 100], [100, 0])).toBe(0);
    });

    it("maps quarter point with inverted target", () => {
      expect(mapValueClamped(25, [0, 100], [100, 0])).toBeCloseTo(75);
    });
  });

  // --- MIDI-specific ranges ---
  describe("MIDI-specific ranges", () => {
    it("identity mapping [0,127] -> [0,127]", () => {
      expect(mapValueClamped(0, [0, 127], [0, 127])).toBe(0);
      expect(mapValueClamped(64, [0, 127], [0, 127])).toBeCloseTo(64);
      expect(mapValueClamped(127, [0, 127], [0, 127])).toBe(127);
    });

    it("maps [40,127] -> [0,127] with value at lower bound", () => {
      expect(mapValueClamped(40, [40, 127], [0, 127])).toBe(0);
    });

    it("maps [40,127] -> [0,127] with value at upper bound", () => {
      expect(mapValueClamped(127, [40, 127], [0, 127])).toBe(127);
    });

    it("maps [40,127] -> [0,127] with value in middle", () => {
      // midpoint of [40, 127] = 83.5
      const result = mapValueClamped(83.5, [40, 127], [0, 127]);
      expect(result).toBeCloseTo(63.5);
    });

    it("maps MIDI to frequency-like range [0,127] -> [20,20000]", () => {
      expect(mapValueClamped(0, [0, 127], [20, 20000])).toBe(20);
      expect(mapValueClamped(127, [0, 127], [20, 20000])).toBe(20000);
    });

    it("clamps MIDI values outside [0,127]", () => {
      expect(mapValueClamped(-1, [0, 127], [0, 1])).toBe(0);
      expect(mapValueClamped(128, [0, 127], [0, 1])).toBe(1);
    });
  });
});

// ---------------------------------------------------------------------------
// mapValueClampedCurried
// ---------------------------------------------------------------------------
describe("mapValueClampedCurried", () => {
  it("produces the same result as non-curried version", () => {
    const mapper = mapValueClampedCurried([0, 127], [0, 1]);
    for (const v of [0, 1, 32, 63, 64, 100, 127]) {
      expect(mapper(v)).toBe(mapValueClamped(v, [0, 127], [0, 1]));
    }
  });

  it("curried mapper can be reused for multiple values", () => {
    const mapper = mapValueClampedCurried([10, 20], [100, 200]);
    expect(mapper(10)).toBe(100);
    expect(mapper(15)).toBeCloseTo(150);
    expect(mapper(20)).toBe(200);
  });

  it("clamps correctly through curried interface", () => {
    const mapper = mapValueClampedCurried([0, 100], [0, 1]);
    expect(mapper(-50)).toBe(0);
    expect(mapper(200)).toBe(1);
  });

  it("handles degenerate range through curried interface", () => {
    const mapper = mapValueClampedCurried([5, 5], [0, 100]);
    // value <= a (5<=5) returns c
    expect(mapper(5)).toBe(0);
  });

  it("handles inverse range through curried interface", () => {
    const mapper = mapValueClampedCurried([0, 100], [100, 0]);
    expect(mapper(50)).toBeCloseTo(50);
    expect(mapper(0)).toBe(100);
    expect(mapper(100)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// mapValueLogClamped
// ---------------------------------------------------------------------------
describe("mapValueLogClamped", () => {
  // --- Normal log scaling (same-sign positive target) ---
  describe("normal logarithmic scaling (positive target range)", () => {
    it("returns to[0] at lower bound", () => {
      expect(mapValueLogClamped(0, [0, 127], [20, 20000])).toBe(20);
    });

    it("returns to[1] at upper bound", () => {
      expect(mapValueLogClamped(127, [0, 127], [20, 20000])).toBe(20000);
    });

    it("produces a value between to[0] and to[1] for midpoint", () => {
      const result = mapValueLogClamped(63.5, [0, 127], [20, 20000]);
      expect(result).toBeGreaterThan(20);
      expect(result).toBeLessThan(20000);
    });

    it("log midpoint is lower than linear midpoint for expanding range", () => {
      // For log scaling from [20, 20000], the log midpoint should be
      // sqrt(20*20000) = ~632, which is much lower than linear midpoint ~10010
      const logResult = mapValueLogClamped(63.5, [0, 127], [20, 20000]);
      const linearResult = mapValueClamped(63.5, [0, 127], [20, 20000]);
      // Log result at midpoint: 20 * (20000/20)^0.5 = 20 * sqrt(1000) ~= 632
      expect(logResult).toBeCloseTo(632.455, 0);
      expect(logResult).toBeLessThan(linearResult);
    });

    it("maps [0,127] -> [1,1000] logarithmically", () => {
      // At t=0.5 (value=63.5): 1 * (1000/1)^0.5 = sqrt(1000) ~= 31.62
      const result = mapValueLogClamped(63.5, [0, 127], [1, 1000]);
      expect(result).toBeCloseTo(31.623, 0);
    });
  });

  // --- Same-sign negative target range ---
  describe("negative same-sign target range", () => {
    it("returns to[0] at lower bound", () => {
      expect(mapValueLogClamped(0, [0, 100], [-100, -1])).toBe(-100);
    });

    it("returns to[1] at upper bound", () => {
      expect(mapValueLogClamped(100, [0, 100], [-100, -1])).toBe(-1);
    });

    it("log-maps correctly with negative same-sign range", () => {
      // sign = -1, absC = 100, absD = 1, ratio = 1/100 = 0.01
      // At t=0.5: -1 * 100 * (0.01)^0.5 = -1 * 100 * 0.1 = -10
      const result = mapValueLogClamped(50, [0, 100], [-100, -1]);
      expect(result).toBeCloseTo(-10, 1);
    });
  });

  // --- Fallback to linear when target crosses zero ---
  describe("fallback to linear mapping", () => {
    it("falls back when to[0] is 0", () => {
      const logResult = mapValueLogClamped(50, [0, 100], [0, 100]);
      const linearResult = mapValueClamped(50, [0, 100], [0, 100]);
      expect(logResult).toBe(linearResult);
    });

    it("falls back when to[1] is 0", () => {
      const logResult = mapValueLogClamped(50, [0, 100], [100, 0]);
      const linearResult = mapValueClamped(50, [0, 100], [100, 0]);
      expect(logResult).toBe(linearResult);
    });

    it("falls back when target range crosses zero (different signs)", () => {
      const logResult = mapValueLogClamped(50, [0, 100], [-50, 50]);
      const linearResult = mapValueClamped(50, [0, 100], [-50, 50]);
      expect(logResult).toBe(linearResult);
    });

    it("falls back when both to values are 0", () => {
      const logResult = mapValueLogClamped(50, [0, 100], [0, 0]);
      const linearResult = mapValueClamped(50, [0, 100], [0, 0]);
      expect(logResult).toBe(linearResult);
    });
  });

  // --- Clamping in log mode ---
  describe("clamping", () => {
    it("clamps below minimum to to[0]", () => {
      expect(mapValueLogClamped(-10, [0, 127], [20, 20000])).toBe(20);
    });

    it("clamps above maximum to to[1]", () => {
      expect(mapValueLogClamped(200, [0, 127], [20, 20000])).toBe(20000);
    });
  });

  // --- Degenerate range ---
  describe("degenerate range (from[0] === from[1])", () => {
    it("returns midpoint of target range when log applies", () => {
      // value <= a (5<=5) returns c
      expect(mapValueLogClamped(5, [5, 5], [1, 100])).toBe(1);
    });

    it("returns c when value equals degenerate point (same as linear)", () => {
      expect(mapValueLogClamped(5, [5, 5], [10, 90])).toBe(10);
    });
  });

  // --- Edge cases ---
  describe("edge cases", () => {
    it("handles to range [1, 1] (single point)", () => {
      // ratio = 1, so 1 * 1^t = 1 for any t
      const result = mapValueLogClamped(50, [0, 100], [1, 1]);
      expect(result).toBeCloseTo(1);
    });

    it("handles very small positive target range", () => {
      const result = mapValueLogClamped(50, [0, 100], [0.001, 1000]);
      expect(result).toBeGreaterThan(0.001);
      expect(result).toBeLessThan(1000);
      // t=0.5: 0.001 * (1000000)^0.5 = 0.001 * 1000 = 1
      expect(result).toBeCloseTo(1, 1);
    });
  });
});

// ---------------------------------------------------------------------------
// mapValueLogClampedCurried
// ---------------------------------------------------------------------------
describe("mapValueLogClampedCurried", () => {
  it("produces the same result as non-curried version", () => {
    const mapper = mapValueLogClampedCurried([0, 127], [20, 20000]);
    for (const v of [0, 1, 32, 63, 64, 100, 127]) {
      expect(mapper(v)).toBe(mapValueLogClamped(v, [0, 127], [20, 20000]));
    }
  });

  it("curried mapper can be reused for multiple values", () => {
    const mapper = mapValueLogClampedCurried([0, 100], [1, 1000]);
    expect(mapper(0)).toBe(1);
    expect(mapper(100)).toBe(1000);
    expect(mapper(50)).toBeCloseTo(31.623, 0);
  });

  it("clamps correctly through curried interface", () => {
    const mapper = mapValueLogClampedCurried([0, 127], [20, 20000]);
    expect(mapper(-50)).toBe(20);
    expect(mapper(200)).toBe(20000);
  });

  it("falls back to linear through curried interface when range crosses zero", () => {
    const logMapper = mapValueLogClampedCurried([0, 100], [-50, 50]);
    const linearMapper = mapValueClampedCurried([0, 100], [-50, 50]);
    for (const v of [0, 25, 50, 75, 100]) {
      expect(logMapper(v)).toBe(linearMapper(v));
    }
  });
});

// ---------------------------------------------------------------------------
// mapValueExponential
// ---------------------------------------------------------------------------
describe("mapValueExponential", () => {
  describe("normal mapping", () => {
    it("midpoint produces value closer to from[0] (slow start)", () => {
      // t=0.5, result = 0 + 100 * 0.25 = 25 (closer to 0 than to 100)
      const result = mapValueExponential(50, [0, 100], [0, 100]);
      expect(result).toBeCloseTo(25);
    });
  });

  describe("boundary values", () => {
    it("returns to[0] when value equals from[0]", () => {
      expect(mapValueExponential(0, [0, 127], [0, 1])).toBe(0);
    });

    it("returns to[1] when value equals from[1]", () => {
      expect(mapValueExponential(127, [0, 127], [0, 1])).toBe(1);
    });
  });

  describe("clamping", () => {
    it("clamps below minimum to to[0]", () => {
      expect(mapValueExponential(-10, [0, 100], [0, 1])).toBe(0);
    });

    it("clamps above maximum to to[1]", () => {
      expect(mapValueExponential(200, [0, 100], [0, 1])).toBe(1);
    });
  });

  it("exponential midpoint is LOWER than linear midpoint for expanding range", () => {
    const expResult = mapValueExponential(63.5, [0, 127], [0, 127]);
    const linearResult = mapValueClamped(63.5, [0, 127], [0, 127]);
    expect(expResult).toBeLessThan(linearResult);
  });

  describe("MIDI ranges", () => {
    it("maps [0,127] -> [0,127]", () => {
      expect(mapValueExponential(0, [0, 127], [0, 127])).toBe(0);
      expect(mapValueExponential(127, [0, 127], [0, 127])).toBe(127);
      // midpoint: t=63.5/127=0.5, result = 127*0.25 = 31.75
      expect(mapValueExponential(63.5, [0, 127], [0, 127])).toBeCloseTo(31.75);
    });
  });
});

// ---------------------------------------------------------------------------
// mapValueExponentialCurried
// ---------------------------------------------------------------------------
describe("mapValueExponentialCurried", () => {
  it("produces the same result as non-curried version", () => {
    const mapper = mapValueExponentialCurried([0, 127], [0, 1]);
    for (const v of [0, 1, 32, 63, 64, 100, 127]) {
      expect(mapper(v)).toBe(mapValueExponential(v, [0, 127], [0, 1]));
    }
  });
});

// ---------------------------------------------------------------------------
// mapValueSCurve
// ---------------------------------------------------------------------------
describe("mapValueSCurve", () => {
  describe("normal mapping", () => {
    it("midpoint maps to midpoint (symmetric)", () => {
      // t=0.5: 3*(0.25) - 2*(0.125) = 0.75 - 0.25 = 0.5
      const result = mapValueSCurve(50, [0, 100], [0, 100]);
      expect(result).toBeCloseTo(50);
    });
  });

  describe("boundary values", () => {
    it("returns to[0] when value equals from[0]", () => {
      expect(mapValueSCurve(0, [0, 127], [0, 1])).toBe(0);
    });

    it("returns to[1] when value equals from[1]", () => {
      expect(mapValueSCurve(127, [0, 127], [0, 1])).toBe(1);
    });
  });

  describe("clamping", () => {
    it("clamps below minimum to to[0]", () => {
      expect(mapValueSCurve(-10, [0, 100], [0, 1])).toBe(0);
    });

    it("clamps above maximum to to[1]", () => {
      expect(mapValueSCurve(200, [0, 100], [0, 1])).toBe(1);
    });
  });

  it("quarter point: s-curve value is LOWER than linear (slow start)", () => {
    const sCurveResult = mapValueSCurve(25, [0, 100], [0, 100]);
    const linearResult = mapValueClamped(25, [0, 100], [0, 100]);
    // t=0.25: 3*(0.0625) - 2*(0.015625) = 0.1875 - 0.03125 = 0.15625
    expect(sCurveResult).toBeCloseTo(15.625);
    expect(sCurveResult).toBeLessThan(linearResult);
  });

  it("three-quarter point: s-curve value is HIGHER than linear (accelerating to finish)", () => {
    const sCurveResult = mapValueSCurve(75, [0, 100], [0, 100]);
    const linearResult = mapValueClamped(75, [0, 100], [0, 100]);
    // t=0.75: 3*(0.5625) - 2*(0.421875) = 1.6875 - 0.84375 = 0.84375
    expect(sCurveResult).toBeCloseTo(84.375);
    expect(sCurveResult).toBeGreaterThan(linearResult);
  });

  it("smoothstep property: derivative is 0 at boundaries", () => {
    // derivative of smoothstep: 6t(1-t), at t=0 -> 0, at t=1 -> 0
    // Test by checking values very close to boundaries are nearly equal to boundary values
    const epsilon = 0.001;
    const nearStart = mapValueSCurve(epsilon, [0, 1], [0, 1]);
    const nearEnd = mapValueSCurve(1 - epsilon, [0, 1], [0, 1]);
    // Near start: slope ~ 0, so value ~ 0
    expect(nearStart).toBeCloseTo(0, 4);
    // Near end: slope ~ 0, so value ~ 1
    expect(nearEnd).toBeCloseTo(1, 4);
  });

  describe("MIDI ranges", () => {
    it("maps [0,127] -> [0,127]", () => {
      expect(mapValueSCurve(0, [0, 127], [0, 127])).toBe(0);
      expect(mapValueSCurve(127, [0, 127], [0, 127])).toBe(127);
      // midpoint: t=0.5, smoothstep=0.5, result=63.5
      expect(mapValueSCurve(63.5, [0, 127], [0, 127])).toBeCloseTo(63.5);
    });
  });
});

// ---------------------------------------------------------------------------
// mapValueSCurveCurried
// ---------------------------------------------------------------------------
describe("mapValueSCurveCurried", () => {
  it("produces the same result as non-curried version", () => {
    const mapper = mapValueSCurveCurried([0, 127], [0, 1]);
    for (const v of [0, 1, 32, 63, 64, 100, 127]) {
      expect(mapper(v)).toBe(mapValueSCurve(v, [0, 127], [0, 1]));
    }
  });
});
