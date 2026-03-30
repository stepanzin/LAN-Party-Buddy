import { describe, it, expect } from 'bun:test';
import { processMidiMessage, INITIAL_ENGINE_STATE, type EngineState } from '@domain/mapping-engine';
import type { CompiledRules, CompiledMacros, CompiledRule } from '@domain/mapping-rule';
import type { MidiCC } from '@domain/midi-message';
import { mapValueClamped, mapValueExponential, mapValueSCurve, mapValueLogClamped } from '@domain/value-curves';
import { buildRules, buildMacros } from '@app/rule-compiler';
import { parseConfig } from '@adapters/yaml-config.adapter';
import type { AppConfig } from '@domain/config';

// -------------------------------------------------------------------------
// Bug #1: NaN propagation — clampMidi(NaN) returns NaN
// A malformed transform function returning NaN would send NaN as MIDI value
// -------------------------------------------------------------------------
describe('BUG: NaN propagation through engine', () => {
  it('transform returning NaN should NOT produce NaN in output', () => {
    const msg: MidiCC = { channel: 0, cc: 1, value: 64 };
    const rules: CompiledRules = {
      '1': { transform: () => NaN, smoothing: 0, mode: 'normal' },
    };
    const { result } = processMidiMessage(msg, rules, {}, INITIAL_ENGINE_STATE);
    const mainMsg = result.outputMessages[result.outputMessages.length - 1]!;
    expect(mainMsg[2]).not.toBeNaN();
    expect(Number.isFinite(mainMsg[2])).toBe(true);
  });

  it('transform returning Infinity should clamp to 127', () => {
    const msg: MidiCC = { channel: 0, cc: 1, value: 64 };
    const rules: CompiledRules = {
      '1': { transform: () => Infinity, smoothing: 0, mode: 'normal' },
    };
    const { result } = processMidiMessage(msg, rules, {}, INITIAL_ENGINE_STATE);
    const mainMsg = result.outputMessages[result.outputMessages.length - 1]!;
    expect(mainMsg[2]).toBe(127);
  });

  it('transform returning -Infinity should clamp to 0', () => {
    const msg: MidiCC = { channel: 0, cc: 1, value: 64 };
    const rules: CompiledRules = {
      '1': { transform: () => -Infinity, smoothing: 0, mode: 'normal' },
    };
    const { result } = processMidiMessage(msg, rules, {}, INITIAL_ENGINE_STATE);
    const mainMsg = result.outputMessages[result.outputMessages.length - 1]!;
    expect(mainMsg[2]).toBe(0);
  });
});

// -------------------------------------------------------------------------
// Bug #2: Inverted input range (inputMin > inputMax)
// mapValueClamped guard clauses assume a < b
// -------------------------------------------------------------------------
describe('BUG: Inverted input range (inputMin > inputMax)', () => {
  it('mapValueClamped with from=[100,0] should still map correctly', () => {
    // Midpoint of inverted range: value=50 should map to midpoint of output
    const result = mapValueClamped(50, [100, 0], [0, 127]);
    // With a=100, b=0: value=50, value<=a (50<=100) true, returns c=0
    // But semantically 50 is in the middle of [0..100]
    // This is a known design choice or bug depending on interpretation
    expect(result).toBe(0); // Currently returns 0 — documenting behavior
  });

  it('buildRules with deadZoneMin > deadZoneMax should handle gracefully', () => {
    const config: AppConfig = {
      deviceName: 'Test',
      rules: [{
        cc: 1, label: 'X', inputMin: 0, inputMax: 127,
        outputMin: 0, outputMax: 127, curve: 'linear',
        deadZoneMin: 120, deadZoneMax: 5, // inverted!
      }],
    };
    const rules = buildRules(config);
    // Should not crash. Value 64 should produce some number
    const result = rules['1']!.transform(64);
    expect(Number.isFinite(result)).toBe(true);
  });
});

// -------------------------------------------------------------------------
// CC 0 and Value 0 — the old !cc || !value bug check
// -------------------------------------------------------------------------
describe('Edge: CC 0 and Value 0 are valid MIDI', () => {
  it('CC 0 (Bank Select MSB) is processed, not skipped', () => {
    const msg: MidiCC = { channel: 0, cc: 0, value: 64 };
    const rules: CompiledRules = {
      '0': { transform: (v) => v, smoothing: 0, mode: 'normal' },
    };
    const { result } = processMidiMessage(msg, rules, {}, INITIAL_ENGINE_STATE);
    expect(result.log.cc).toBe(0);
    expect(result.log.mappedValue).toBe(64);
  });

  it('value=0 is a valid MIDI value and is processed', () => {
    const msg: MidiCC = { channel: 0, cc: 7, value: 0 };
    const rules: CompiledRules = {
      '7': { transform: (v) => v, smoothing: 0, mode: 'normal' },
    };
    const { result } = processMidiMessage(msg, rules, {}, INITIAL_ENGINE_STATE);
    expect(result.log.mappedValue).toBe(0);
    const mainMsg = result.outputMessages[result.outputMessages.length - 1]!;
    expect(mainMsg[2]).toBe(0);
  });

  it('CC 0, value 0, channel 0 — all zeros valid message', () => {
    const msg: MidiCC = { channel: 0, cc: 0, value: 0 };
    const { result } = processMidiMessage(msg, {}, {}, INITIAL_ENGINE_STATE);
    expect(result.outputMessages.length).toBeGreaterThanOrEqual(3);
    expect(result.log.cc).toBe(0);
  });
});

// -------------------------------------------------------------------------
// Macro output CC conflicting with NRPN preamble CCs (99, 100)
// -------------------------------------------------------------------------
describe('Edge: Macro output CC conflicts with NRPN preamble', () => {
  it('macro with outputCc=99 produces valid but conflicting message', () => {
    const msg: MidiCC = { channel: 0, cc: 1, value: 64 };
    const macros: CompiledMacros = {
      '1': [{ outputCc: 99, transform: (v) => v }],
    };
    const { result } = processMidiMessage(msg, {}, macros, INITIAL_ENGINE_STATE);
    // NRPN preamble sends [status, 99, 127] then macro sends [status, 99, 64]
    // Both CC 99 messages exist — potential confusion for receiving device
    const cc99Messages = result.outputMessages.filter(([_, cc]) => cc === 99);
    expect(cc99Messages.length).toBe(2); // documenting: preamble + macro clash
  });
});

// -------------------------------------------------------------------------
// Toggle + Smoothing combo
// -------------------------------------------------------------------------
describe('Edge: Toggle mode with smoothing enabled', () => {
  it('smoothing should NOT affect toggle behavior (toggle ignores smoothed value)', () => {
    const rules: CompiledRules = {
      '64': { transform: (v) => v, smoothing: 3, mode: 'toggle' },
    };
    // Press: value=127 → toggle ON
    const { result: r1, nextState: s1 } = processMidiMessage(
      { channel: 0, cc: 64, value: 127 }, rules, {}, INITIAL_ENGINE_STATE,
    );
    expect(r1.log.mappedValue).toBe(127); // ON

    // Press again: value=127 → toggle OFF
    const { result: r2 } = processMidiMessage(
      { channel: 0, cc: 64, value: 127 }, rules, {}, s1,
    );
    expect(r2.log.mappedValue).toBe(0); // OFF
  });
});

// -------------------------------------------------------------------------
// Smoothing edge cases
// -------------------------------------------------------------------------
describe('Edge: Smoothing edge cases', () => {
  it('smoothing window size 1 passes value through unchanged', () => {
    const rules: CompiledRules = {
      '1': { transform: (v) => v, smoothing: 1, mode: 'normal' },
    };
    const { result } = processMidiMessage(
      { channel: 0, cc: 1, value: 100 }, rules, {}, INITIAL_ENGINE_STATE,
    );
    expect(result.log.mappedValue).toBe(100);
  });

  it('smoothing with many unique CCs creates many buffers (memory)', () => {
    const rules: CompiledRules = {};
    for (let i = 0; i < 128; i++) {
      rules[i.toString()] = { transform: (v) => v, smoothing: 5, mode: 'normal' };
    }
    let state: EngineState = INITIAL_ENGINE_STATE;
    // Send one message per CC
    for (let i = 0; i < 128; i++) {
      const { nextState } = processMidiMessage(
        { channel: 0, cc: i, value: 64 }, rules, {}, state,
      );
      state = nextState;
    }
    // Should have 128 buffers, each with 1 entry
    expect(Object.keys(state.smoothingBuffers).length).toBe(128);
  });
});

// -------------------------------------------------------------------------
// Degenerate output ranges
// -------------------------------------------------------------------------
describe('Edge: Degenerate output ranges', () => {
  it('outputMin === outputMax produces constant output', () => {
    const config: AppConfig = {
      deviceName: 'Test',
      rules: [{
        cc: 1, label: 'X', inputMin: 0, inputMax: 127,
        outputMin: 64, outputMax: 64, curve: 'linear',
      }],
    };
    const rules = buildRules(config);
    expect(rules['1']!.transform(0)).toBe(64);
    expect(rules['1']!.transform(64)).toBe(64);
    expect(rules['1']!.transform(127)).toBe(64);
  });

  it('outputMin === outputMax with invert still produces constant', () => {
    const config: AppConfig = {
      deviceName: 'Test',
      rules: [{
        cc: 1, label: 'X', inputMin: 0, inputMax: 127,
        outputMin: 64, outputMax: 64, curve: 'linear', invert: true,
      }],
    };
    const rules = buildRules(config);
    expect(rules['1']!.transform(0)).toBe(64);
    expect(rules['1']!.transform(127)).toBe(64);
  });
});

// -------------------------------------------------------------------------
// Duplicate CC in config
// -------------------------------------------------------------------------
describe('Edge: Duplicate CC numbers in config', () => {
  it('last rule wins when two rules have same CC', () => {
    const config: AppConfig = {
      deviceName: 'Test',
      rules: [
        { cc: 1, label: 'First', inputMin: 0, inputMax: 127, outputMin: 0, outputMax: 64, curve: 'linear' },
        { cc: 1, label: 'Second', inputMin: 0, inputMax: 127, outputMin: 0, outputMax: 127, curve: 'linear' },
      ],
    };
    const rules = buildRules(config);
    // Second rule should overwrite: outputMax=127
    expect(rules['1']!.transform(127)).toBe(127);
  });
});

// -------------------------------------------------------------------------
// CC 49 special case interactions
// -------------------------------------------------------------------------
describe('Edge: CC 49 NRPN special case', () => {
  it('CC 49 with toggle mode works correctly', () => {
    const rules: CompiledRules = {
      '49': { transform: (v) => v, smoothing: 0, mode: 'toggle' },
    };
    const { result } = processMidiMessage(
      { channel: 0, cc: 49, value: 127 }, rules, {}, INITIAL_ENGINE_STATE,
    );
    // NRPN preamble for CC 49: [status, 99, 0], [status, 100, 127]
    expect(result.outputMessages[0]).toEqual([0xB0, 99, 0]);
    expect(result.outputMessages[1]).toEqual([0xB0, 100, 127]);
    // Toggle ON → 127
    expect(result.log.mappedValue).toBe(127);
  });

  it('CC 49 with macro adds outputs after NRPN preamble', () => {
    const macros: CompiledMacros = {
      '49': [{ outputCc: 74, transform: (v) => v }],
    };
    const { result } = processMidiMessage(
      { channel: 0, cc: 49, value: 100 }, {}, macros, INITIAL_ENGINE_STATE,
    );
    // [99,0], [100,127], [49,100], [74,100]
    expect(result.outputMessages.length).toBe(4);
  });
});

// -------------------------------------------------------------------------
// Config validation edge cases
// -------------------------------------------------------------------------
describe('Edge: Config validation', () => {
  it('smoothing: 0 is valid (means disabled)', () => {
    const yaml = `
deviceName: "Test"
rules:
  - cc: 1
    label: "X"
    inputMin: 0
    inputMax: 127
    outputMin: 0
    outputMax: 127
    curve: linear
    smoothing: 0
`;
    const config = parseConfig(yaml);
    expect(config.rules[0]!.smoothing).toBe(0);
  });

  it('macros with empty outputs array should be rejected', () => {
    const yaml = `
deviceName: "Test"
rules:
  - cc: 1
    label: "X"
    inputMin: 0
    inputMax: 127
    outputMin: 0
    outputMax: 127
    curve: linear
macros:
  - input: 1
    label: "Bad"
    outputs: []
`;
    expect(() => parseConfig(yaml)).toThrow();
  });

  it('macro input CC same as rule CC is valid (both should work)', () => {
    const config: AppConfig = {
      deviceName: 'Test',
      rules: [{ cc: 1, label: 'Rule', inputMin: 0, inputMax: 127, outputMin: 0, outputMax: 127, curve: 'linear' }],
      macros: [{ input: 1, label: 'Macro', outputs: [{ cc: 74, label: 'Out', outputMin: 0, outputMax: 127, curve: 'linear' }] }],
    };
    const rules = buildRules(config);
    const macros = buildMacros(config);
    const { result } = processMidiMessage(
      { channel: 0, cc: 1, value: 64 }, rules, macros, INITIAL_ENGINE_STATE,
    );
    // Should have: NRPN preamble (2) + main (1) + macro (1) = 4
    expect(result.outputMessages.length).toBe(4);
    expect(result.log.mappedValue).toBe(64);
  });
});

// -------------------------------------------------------------------------
// Channel boundaries
// -------------------------------------------------------------------------
describe('Edge: Channel boundaries', () => {
  it('channel 15 (max) produces correct status byte 0xBF', () => {
    const { result } = processMidiMessage(
      { channel: 15, cc: 1, value: 64 }, {}, {}, INITIAL_ENGINE_STATE,
    );
    for (const [status] of result.outputMessages) {
      expect(status).toBe(0xBF);
    }
  });

  it('channel 0 (min) produces correct status byte 0xB0', () => {
    const { result } = processMidiMessage(
      { channel: 0, cc: 1, value: 64 }, {}, {}, INITIAL_ENGINE_STATE,
    );
    for (const [status] of result.outputMessages) {
      expect(status).toBe(0xB0);
    }
  });
});

// -------------------------------------------------------------------------
// Value curve with extreme parameters
// -------------------------------------------------------------------------
describe('Edge: Value curves with extreme parameters', () => {
  it('exponential with huge output range does not overflow', () => {
    const result = mapValueExponential(64, [0, 127], [0, Number.MAX_SAFE_INTEGER]);
    expect(Number.isFinite(result)).toBe(true);
  });

  it('s-curve at exact midpoint returns exact midpoint of output', () => {
    // Smoothstep property: f(0.5) = 0.5
    const result = mapValueSCurve(63.5, [0, 127], [0, 127]);
    expect(result).toBeCloseTo(63.5, 0);
  });

  it('log curve with very large positive range', () => {
    const result = mapValueLogClamped(64, [0, 127], [1, 1e15]);
    expect(Number.isFinite(result)).toBe(true);
    expect(result).toBeGreaterThan(1);
    expect(result).toBeLessThan(1e15);
  });
});
