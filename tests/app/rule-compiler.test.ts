import { describe, expect, it } from 'bun:test';
import { buildMacros, buildRules } from '@app/rule-compiler';
import type { AppConfig } from '@domain/config';
import { mapValueClamped, mapValueExponential, mapValueLogClamped, mapValueSCurve } from '@domain/value-curves';

// ---------------------------------------------------------------------------
// buildRules
// ---------------------------------------------------------------------------
describe('buildRules', () => {
  it('builds a rules record from config with linear curve', () => {
    const config: AppConfig = {
      deviceName: 'Out',
      mode: 'local',
      rules: [
        {
          cc: 4,
          label: 'Pedal',
          inputMin: 40,
          inputMax: 127,
          outputMin: 0,
          outputMax: 127,
          curve: 'linear',
        },
      ],
    };
    const rules = buildRules(config);
    expect(rules).toHaveProperty('4');
    const rule = rules['4']!;
    expect(typeof rule.transform).toBe('function');
    expect(rule.smoothing).toBe(0);
    expect(rule.mode).toBe('normal');
  });

  it('linear rule maps values using mapValueClamped + round', () => {
    const config: AppConfig = {
      deviceName: 'Out',
      mode: 'local',
      rules: [
        {
          cc: 4,
          label: 'Pedal',
          inputMin: 40,
          inputMax: 127,
          outputMin: 0,
          outputMax: 127,
          curve: 'linear',
        },
      ],
    };
    const rules = buildRules(config);
    const mapper = rules['4']!.transform;

    // Boundary
    expect(mapper(40)).toBe(0);
    expect(mapper(127)).toBe(127);
    // Below min -> clamped
    expect(mapper(0)).toBe(0);
    // Above max -> clamped
    expect(mapper(200)).toBe(127);
    // Mid value
    expect(mapper(83.5)).toBe(Math.round(mapValueClamped(83.5, [40, 127], [0, 127])));
  });

  it('logarithmic rule maps values using mapValueLogClamped + round', () => {
    const config: AppConfig = {
      deviceName: 'Out',
      mode: 'local',
      rules: [
        {
          cc: 11,
          label: 'Expression',
          inputMin: 0,
          inputMax: 127,
          outputMin: 20,
          outputMax: 20000,
          curve: 'logarithmic',
        },
      ],
    };
    const rules = buildRules(config);
    const mapper = rules['11']!.transform;

    expect(mapper(0)).toBe(20);
    expect(mapper(127)).toBe(20000);
    // Mid value should match log mapping
    const expected = Math.round(mapValueLogClamped(64, [0, 127], [20, 20000]));
    expect(mapper(64)).toBe(expected);
  });

  it('exponential rule maps values using mapValueExponential + round', () => {
    const config: AppConfig = {
      deviceName: 'Out',
      mode: 'local',
      rules: [
        {
          cc: 7,
          label: 'Volume',
          inputMin: 0,
          inputMax: 127,
          outputMin: 0,
          outputMax: 127,
          curve: 'exponential',
        },
      ],
    };
    const rules = buildRules(config);
    const mapper = rules['7']!.transform;

    expect(mapper(0)).toBe(0);
    expect(mapper(127)).toBe(127);
    const expected = Math.round(mapValueExponential(64, [0, 127], [0, 127]));
    expect(mapper(64)).toBe(expected);
  });

  it('s-curve rule maps values using mapValueSCurve + round', () => {
    const config: AppConfig = {
      deviceName: 'Out',
      mode: 'local',
      rules: [
        {
          cc: 8,
          label: 'Balance',
          inputMin: 0,
          inputMax: 127,
          outputMin: 0,
          outputMax: 127,
          curve: 's-curve',
        },
      ],
    };
    const rules = buildRules(config);
    const mapper = rules['8']!.transform;

    expect(mapper(0)).toBe(0);
    expect(mapper(127)).toBe(127);
    const expected = Math.round(mapValueSCurve(64, [0, 127], [0, 127]));
    expect(mapper(64)).toBe(expected);
  });

  it('builds multiple rules keyed by cc number', () => {
    const config: AppConfig = {
      deviceName: 'Out',
      mode: 'local',
      rules: [
        {
          cc: 4,
          label: 'A',
          inputMin: 0,
          inputMax: 127,
          outputMin: 0,
          outputMax: 127,
          curve: 'linear',
        },
        {
          cc: 5,
          label: 'B',
          inputMin: 0,
          inputMax: 127,
          outputMin: 0,
          outputMax: 64,
          curve: 'linear',
        },
      ],
    };
    const rules = buildRules(config);
    expect(rules).toHaveProperty('4');
    expect(rules).toHaveProperty('5');
    expect(rules['4']!.transform(127)).toBe(127);
    expect(rules['5']!.transform(127)).toBe(64);
  });

  it('returns empty record for config with empty rules', () => {
    const rules = buildRules({ deviceName: 'X', mode: 'local', rules: [] });
    expect(Object.keys(rules)).toHaveLength(0);
  });

  it('invert: true swaps outputMin and outputMax', () => {
    const config: AppConfig = {
      deviceName: 'Out',
      mode: 'local',
      rules: [
        {
          cc: 1,
          label: 'Inverted',
          inputMin: 0,
          inputMax: 127,
          outputMin: 0,
          outputMax: 127,
          curve: 'linear',
          invert: true,
        },
      ],
    };
    const rules = buildRules(config);
    const mapper = rules['1']!.transform;

    // With invert, output is reversed: inputMin -> outputMax, inputMax -> outputMin
    expect(mapper(0)).toBe(127);
    expect(mapper(127)).toBe(0);
    expect(mapper(64)).toBe(Math.round(mapValueClamped(64, [0, 127], [127, 0])));
  });

  it('deadZoneMin/deadZoneMax override inputMin/inputMax for curve mapping', () => {
    const config: AppConfig = {
      deviceName: 'Out',
      mode: 'local',
      rules: [
        {
          cc: 2,
          label: 'DeadZone',
          inputMin: 0,
          inputMax: 127,
          outputMin: 0,
          outputMax: 127,
          curve: 'linear',
          deadZoneMin: 20,
          deadZoneMax: 100,
        },
      ],
    };
    const rules = buildRules(config);
    const mapper = rules['2']!.transform;

    // deadZoneMin=20, deadZoneMax=100 used as input range
    expect(mapper(20)).toBe(0);
    expect(mapper(100)).toBe(127);
    // Below deadZoneMin clamped to outputMin
    expect(mapper(0)).toBe(0);
    // Above deadZoneMax clamped to outputMax
    expect(mapper(127)).toBe(127);
    // Mid value
    expect(mapper(60)).toBe(Math.round(mapValueClamped(60, [20, 100], [0, 127])));
  });

  it('smoothing and mode metadata are carried through', () => {
    const config: AppConfig = {
      deviceName: 'Out',
      mode: 'local',
      rules: [
        {
          cc: 3,
          label: 'Smooth Toggle',
          inputMin: 0,
          inputMax: 127,
          outputMin: 0,
          outputMax: 127,
          curve: 'linear',
          smoothing: 5,
          mode: 'toggle',
        },
      ],
    };
    const rules = buildRules(config);
    const rule = rules['3']!;
    expect(rule.smoothing).toBe(5);
    expect(rule.mode).toBe('toggle');
    // transform still works
    expect(rule.transform(0)).toBe(0);
    expect(rule.transform(127)).toBe(127);
  });

  it('defaults smoothing to 0 and mode to normal when not specified', () => {
    const config: AppConfig = {
      deviceName: 'Out',
      mode: 'local',
      rules: [
        {
          cc: 6,
          label: 'Default',
          inputMin: 0,
          inputMax: 127,
          outputMin: 0,
          outputMax: 127,
          curve: 'linear',
        },
      ],
    };
    const rules = buildRules(config);
    const rule = rules['6']!;
    expect(rule.smoothing).toBe(0);
    expect(rule.mode).toBe('normal');
  });

  it('CompiledRule has transform, smoothing, mode fields', () => {
    const config: AppConfig = {
      deviceName: 'Out',
      mode: 'local',
      rules: [
        {
          cc: 10,
          label: 'Fields',
          inputMin: 0,
          inputMax: 127,
          outputMin: 10,
          outputMax: 100,
          curve: 'exponential',
          smoothing: 3,
          mode: 'toggle',
        },
      ],
    };
    const rules = buildRules(config);
    const rule = rules['10']!;
    expect(rule).toHaveProperty('transform');
    expect(rule).toHaveProperty('smoothing');
    expect(rule).toHaveProperty('mode');
    expect(typeof rule.transform).toBe('function');
    expect(typeof rule.smoothing).toBe('number');
    expect(typeof rule.mode).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// buildMacros
// ---------------------------------------------------------------------------
describe('buildMacros', () => {
  it('returns empty record when no macros in config', () => {
    const config: AppConfig = {
      deviceName: 'Out',
      mode: 'local',
      rules: [
        {
          cc: 1,
          label: 'X',
          inputMin: 0,
          inputMax: 127,
          outputMin: 0,
          outputMax: 127,
          curve: 'linear',
        },
      ],
    };
    const macros = buildMacros(config);
    expect(Object.keys(macros)).toHaveLength(0);
  });

  it('builds macro with single output', () => {
    const config: AppConfig = {
      deviceName: 'Out',
      mode: 'local',
      rules: [],
      macros: [
        {
          input: 10,
          label: 'Macro1',
          outputs: [
            {
              cc: 20,
              label: 'Out1',
              outputMin: 0,
              outputMax: 127,
              curve: 'linear',
            },
          ],
        },
      ],
    };
    const macros = buildMacros(config);
    expect(macros).toHaveProperty('10');
    expect(macros['10']).toHaveLength(1);
    expect(macros['10']![0]!.outputCc).toBe(20);
    expect(typeof macros['10']![0]!.transform).toBe('function');

    // Verify transform works (linear 0-127 -> 0-127)
    expect(macros['10']![0]!.transform(0)).toBe(0);
    expect(macros['10']![0]!.transform(127)).toBe(127);
    expect(macros['10']![0]!.transform(64)).toBe(Math.round(mapValueClamped(64, [0, 127], [0, 127])));
  });

  it('builds macro with multiple outputs', () => {
    const config: AppConfig = {
      deviceName: 'Out',
      mode: 'local',
      rules: [],
      macros: [
        {
          input: 15,
          label: 'MultiOut',
          outputs: [
            {
              cc: 30,
              label: 'Out1',
              outputMin: 0,
              outputMax: 64,
              curve: 'linear',
            },
            {
              cc: 31,
              label: 'Out2',
              outputMin: 10,
              outputMax: 100,
              curve: 'exponential',
            },
          ],
        },
      ],
    };
    const macros = buildMacros(config);
    expect(macros['15']).toHaveLength(2);
    expect(macros['15']![0]!.outputCc).toBe(30);
    expect(macros['15']![1]!.outputCc).toBe(31);

    // First output: linear 0-127 -> 0-64
    expect(macros['15']![0]!.transform(0)).toBe(0);
    expect(macros['15']![0]!.transform(127)).toBe(64);

    // Second output: exponential 0-127 -> 10-100
    expect(macros['15']![1]!.transform(0)).toBe(10);
    expect(macros['15']![1]!.transform(127)).toBe(100);
    const expected = Math.round(mapValueExponential(64, [0, 127], [10, 100]));
    expect(macros['15']![1]!.transform(64)).toBe(expected);
  });

  it('builds macro with invert on one output', () => {
    const config: AppConfig = {
      deviceName: 'Out',
      mode: 'local',
      rules: [],
      macros: [
        {
          input: 5,
          label: 'InvertMacro',
          outputs: [
            {
              cc: 40,
              label: 'Normal',
              outputMin: 0,
              outputMax: 127,
              curve: 'linear',
            },
            {
              cc: 41,
              label: 'Inverted',
              outputMin: 0,
              outputMax: 127,
              curve: 'linear',
              invert: true,
            },
          ],
        },
      ],
    };
    const macros = buildMacros(config);
    expect(macros['5']).toHaveLength(2);

    // Normal output
    expect(macros['5']![0]!.transform(0)).toBe(0);
    expect(macros['5']![0]!.transform(127)).toBe(127);

    // Inverted output: outputMin/outputMax swapped -> maps 0->127, 127->0
    expect(macros['5']![1]!.transform(0)).toBe(127);
    expect(macros['5']![1]!.transform(127)).toBe(0);
  });
});
