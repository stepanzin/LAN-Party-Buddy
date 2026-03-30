import { describe, it, expect } from 'bun:test';
import { unlink } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';
import { YamlConfigAdapter, YamlConfigWriterAdapter, parseConfig } from '@adapters/yaml-config.adapter';
import type { AppConfig } from '@domain/config';

// ---------------------------------------------------------------------------
// parseConfig (unit tests — moved from config-loader.test.ts)
// ---------------------------------------------------------------------------
describe('parseConfig', () => {
  const validYaml = `
deviceName: "Test Output"
rules:
  - cc: 4
    label: "Left Pedal"
    inputMin: 40
    inputMax: 127
    outputMin: 0
    outputMax: 127
    curve: linear
`;

  const twoRulesYaml = `
deviceName: "Test Output"
rules:
  - cc: 4
    label: "Left Pedal"
    inputMin: 40
    inputMax: 127
    outputMin: 0
    outputMax: 127
    curve: linear
  - cc: 5
    label: "Right Pedal"
    inputMin: 0
    inputMax: 127
    outputMin: 20
    outputMax: 20000
    curve: logarithmic
`;

  describe('valid config', () => {
    it('parses a valid single-rule config', () => {
      const config = parseConfig(validYaml);
      expect(config.deviceName).toBe('Test Output');
      expect(config.rules).toHaveLength(1);
      expect(config.rules[0]).toEqual({
        cc: 4,
        label: 'Left Pedal',
        inputMin: 40,
        inputMax: 127,
        outputMin: 0,
        outputMax: 127,
        curve: 'linear',
      });
    });

    it('parses multiple rules', () => {
      const config = parseConfig(twoRulesYaml);
      expect(config.rules).toHaveLength(2);
      expect(config.rules[1]!.curve).toBe('logarithmic');
    });

    it('accepts cc: 0 as valid', () => {
      const yaml = `
deviceName: "Out"
rules:
  - cc: 0
    label: "Bank Select"
    inputMin: 0
    inputMax: 127
    outputMin: 0
    outputMax: 127
    curve: linear
`;
      const config = parseConfig(yaml);
      expect(config.rules[0]!.cc).toBe(0);
    });

    it('accepts outputMin > outputMax (inverse range)', () => {
      const yaml = `
deviceName: "Out"
rules:
  - cc: 1
    label: "Inverted"
    inputMin: 0
    inputMax: 127
    outputMin: 127
    outputMax: 0
    curve: linear
`;
      const config = parseConfig(yaml);
      expect(config.rules[0]!.outputMin).toBe(127);
      expect(config.rules[0]!.outputMax).toBe(0);
    });

    it('accepts new optional fields (smoothing, invert, mode, deadZoneMin, deadZoneMax)', () => {
      const yaml = `
deviceName: "Out"
rules:
  - cc: 1
    label: "Full"
    inputMin: 0
    inputMax: 127
    outputMin: 0
    outputMax: 127
    curve: exponential
    smoothing: 5
    invert: true
    mode: toggle
    deadZoneMin: 10
    deadZoneMax: 120
`;
      const config = parseConfig(yaml);
      const rule = config.rules[0]!;
      expect(rule.smoothing).toBe(5);
      expect(rule.invert).toBe(true);
      expect(rule.mode).toBe('toggle');
      expect(rule.deadZoneMin).toBe(10);
      expect(rule.deadZoneMax).toBe(120);
      expect(rule.curve).toBe('exponential');
    });

    it('accepts exponential curve', () => {
      const yaml = `
deviceName: "Out"
rules:
  - cc: 1
    label: "Exp"
    inputMin: 0
    inputMax: 127
    outputMin: 0
    outputMax: 127
    curve: exponential
`;
      const config = parseConfig(yaml);
      expect(config.rules[0]!.curve).toBe('exponential');
    });

    it('accepts s-curve', () => {
      const yaml = `
deviceName: "Out"
rules:
  - cc: 1
    label: "SCurve"
    inputMin: 0
    inputMax: 127
    outputMin: 0
    outputMax: 127
    curve: s-curve
`;
      const config = parseConfig(yaml);
      expect(config.rules[0]!.curve).toBe('s-curve');
    });

    it('accepts config with macros section', () => {
      const yaml = `
deviceName: "Out"
rules:
  - cc: 1
    label: "X"
    inputMin: 0
    inputMax: 127
    outputMin: 0
    outputMax: 127
    curve: linear
macros:
  - input: 10
    label: "Macro1"
    outputs:
      - cc: 20
        label: "Out1"
        outputMin: 0
        outputMax: 127
        curve: linear
      - cc: 21
        label: "Out2"
        outputMin: 10
        outputMax: 100
        curve: exponential
        invert: true
`;
      const config = parseConfig(yaml);
      expect(config.macros).toHaveLength(1);
      expect(config.macros![0]!.input).toBe(10);
      expect(config.macros![0]!.label).toBe('Macro1');
      expect(config.macros![0]!.outputs).toHaveLength(2);
      expect(config.macros![0]!.outputs[0]!.cc).toBe(20);
      expect(config.macros![0]!.outputs[1]!.invert).toBe(true);
    });

    it('config without macros is valid', () => {
      const config = parseConfig(validYaml);
      expect(config.macros).toBeUndefined();
    });
  });

  describe('invalid YAML', () => {
    it('throws on unparseable YAML', () => {
      expect(() => parseConfig('{{{')).toThrow();
    });

    it('throws on empty string', () => {
      expect(() => parseConfig('')).toThrow();
    });

    it('throws on null YAML document', () => {
      expect(() => parseConfig('null')).toThrow();
    });

    it('throws on YAML that parses to a scalar', () => {
      expect(() => parseConfig('just a string')).toThrow();
    });

    it('throws on YAML array at top level', () => {
      expect(() => parseConfig('- item1\n- item2')).toThrow();
    });
  });

  describe('invalid deviceName', () => {
    it('throws when deviceName is missing', () => {
      const yaml = `
rules:
  - cc: 1
    label: "X"
    inputMin: 0
    inputMax: 127
    outputMin: 0
    outputMax: 127
    curve: linear
`;
      expect(() => parseConfig(yaml)).toThrow(/deviceName/);
    });

    it('throws when deviceName is empty string', () => {
      const yaml = `
deviceName: ""
rules:
  - cc: 1
    label: "X"
    inputMin: 0
    inputMax: 127
    outputMin: 0
    outputMax: 127
    curve: linear
`;
      expect(() => parseConfig(yaml)).toThrow(/deviceName/);
    });

    it('throws when deviceName is not a string', () => {
      const yaml = `
deviceName: 123
rules:
  - cc: 1
    label: "X"
    inputMin: 0
    inputMax: 127
    outputMin: 0
    outputMax: 127
    curve: linear
`;
      expect(() => parseConfig(yaml)).toThrow(/deviceName/);
    });
  });

  describe('invalid rules', () => {
    it('throws when rules is missing', () => {
      expect(() => parseConfig('deviceName: "Out"')).toThrow(/rules/);
    });

    it('throws when rules is empty array', () => {
      const yaml = `
deviceName: "Out"
rules: []
`;
      expect(() => parseConfig(yaml)).toThrow(/rules/);
    });

    it('throws when rules is not an array', () => {
      const yaml = `
deviceName: "Out"
rules: "not an array"
`;
      expect(() => parseConfig(yaml)).toThrow(/rules/);
    });
  });

  describe('invalid rule type', () => {
    it('throws when a rule is a scalar instead of object', () => {
      const yaml = `
deviceName: "Out"
rules:
  - "just a string"
`;
      expect(() => parseConfig(yaml)).toThrow(/rule\[0\]/);
    });

    it('throws when a rule is null', () => {
      const yaml = `
deviceName: "Out"
rules:
  - null
`;
      expect(() => parseConfig(yaml)).toThrow(/rule\[0\]/);
    });
  });

  describe('invalid rule fields', () => {
    const makeYaml = (ruleOverride: string) => `
deviceName: "Out"
rules:
  - ${ruleOverride}
`;

    it('throws when cc is missing', () => {
      expect(() => parseConfig(makeYaml(`
    label: "X"
    inputMin: 0
    inputMax: 127
    outputMin: 0
    outputMax: 127
    curve: linear`))).toThrow(/cc/);
    });

    it('throws when cc is negative', () => {
      expect(() => parseConfig(makeYaml(`cc: -1
    label: "X"
    inputMin: 0
    inputMax: 127
    outputMin: 0
    outputMax: 127
    curve: linear`))).toThrow(/cc/);
    });

    it('throws when cc > 127', () => {
      expect(() => parseConfig(makeYaml(`cc: 128
    label: "X"
    inputMin: 0
    inputMax: 127
    outputMin: 0
    outputMax: 127
    curve: linear`))).toThrow(/cc/);
    });

    it('throws when cc is not an integer', () => {
      expect(() => parseConfig(makeYaml(`cc: 1.5
    label: "X"
    inputMin: 0
    inputMax: 127
    outputMin: 0
    outputMax: 127
    curve: linear`))).toThrow(/cc/);
    });

    it('throws when label is missing', () => {
      expect(() => parseConfig(makeYaml(`cc: 1
    inputMin: 0
    inputMax: 127
    outputMin: 0
    outputMax: 127
    curve: linear`))).toThrow(/label/);
    });

    it('throws when label is not a string', () => {
      expect(() => parseConfig(makeYaml(`cc: 1
    label: 123
    inputMin: 0
    inputMax: 127
    outputMin: 0
    outputMax: 127
    curve: linear`))).toThrow(/label/);
    });

    it('throws when inputMin is missing', () => {
      expect(() => parseConfig(makeYaml(`cc: 1
    label: "X"
    inputMax: 127
    outputMin: 0
    outputMax: 127
    curve: linear`))).toThrow(/inputMin/);
    });

    it('throws when inputMin is not a number', () => {
      expect(() => parseConfig(makeYaml(`cc: 1
    label: "X"
    inputMin: "zero"
    inputMax: 127
    outputMin: 0
    outputMax: 127
    curve: linear`))).toThrow(/inputMin/);
    });

    it('throws when inputMax is missing', () => {
      expect(() => parseConfig(makeYaml(`cc: 1
    label: "X"
    inputMin: 0
    outputMin: 0
    outputMax: 127
    curve: linear`))).toThrow(/inputMax/);
    });

    it('throws when outputMin is missing', () => {
      expect(() => parseConfig(makeYaml(`cc: 1
    label: "X"
    inputMin: 0
    inputMax: 127
    outputMax: 127
    curve: linear`))).toThrow(/outputMin/);
    });

    it('throws when outputMax is missing', () => {
      expect(() => parseConfig(makeYaml(`cc: 1
    label: "X"
    inputMin: 0
    inputMax: 127
    outputMin: 0
    curve: linear`))).toThrow(/outputMax/);
    });

    it('throws when curve is missing', () => {
      expect(() => parseConfig(makeYaml(`cc: 1
    label: "X"
    inputMin: 0
    inputMax: 127
    outputMin: 0
    outputMax: 127`))).toThrow(/curve/);
    });

    it('throws when curve is invalid value', () => {
      expect(() => parseConfig(makeYaml(`cc: 1
    label: "X"
    inputMin: 0
    inputMax: 127
    outputMin: 0
    outputMax: 127
    curve: quadratic`))).toThrow(/curve/);
    });

    it('includes rule index in error for second rule', () => {
      const yaml = `
deviceName: "Out"
rules:
  - cc: 1
    label: "OK"
    inputMin: 0
    inputMax: 127
    outputMin: 0
    outputMax: 127
    curve: linear
  - cc: 200
    label: "Bad"
    inputMin: 0
    inputMax: 127
    outputMin: 0
    outputMax: 127
    curve: linear
`;
      expect(() => parseConfig(yaml)).toThrow(/rule\[1\]/i);
    });
  });

  describe('invalid new optional fields', () => {
    const makeYaml = (extra: string) => `
deviceName: "Out"
rules:
  - cc: 1
    label: "X"
    inputMin: 0
    inputMax: 127
    outputMin: 0
    outputMax: 127
    curve: linear
    ${extra}
`;

    it('throws when smoothing is negative', () => {
      expect(() => parseConfig(makeYaml('smoothing: -1'))).toThrow(/smoothing/);
    });

    it('throws when smoothing is not an integer', () => {
      expect(() => parseConfig(makeYaml('smoothing: 1.5'))).toThrow(/smoothing/);
    });

    it('throws when smoothing is not a number', () => {
      expect(() => parseConfig(makeYaml('smoothing: "fast"'))).toThrow(/smoothing/);
    });

    it('throws when invert is not a boolean', () => {
      expect(() => parseConfig(makeYaml('invert: "yes"'))).toThrow(/invert/);
    });

    it('throws when invert is a number', () => {
      expect(() => parseConfig(makeYaml('invert: 1'))).toThrow(/invert/);
    });

    it('throws when mode is invalid value', () => {
      expect(() => parseConfig(makeYaml('mode: "latch"'))).toThrow(/mode/);
    });

    it('throws when mode is not a string', () => {
      expect(() => parseConfig(makeYaml('mode: 123'))).toThrow(/mode/);
    });

    it('throws when deadZoneMin is not a number', () => {
      expect(() => parseConfig(makeYaml('deadZoneMin: "low"'))).toThrow(/deadZoneMin/);
    });

    it('throws when deadZoneMax is not a number', () => {
      expect(() => parseConfig(makeYaml('deadZoneMax: true'))).toThrow(/deadZoneMax/);
    });
  });

  describe('valid config with network section', () => {
    it('parses config with full network section', () => {
      const yaml = `
deviceName: "Out"
rules:
  - cc: 1
    label: "X"
    inputMin: 0
    inputMax: 127
    outputMin: 0
    outputMax: 127
    curve: linear
network:
  port: 9900
  pin: "1234"
  hostName: "My MIDI Mapper"
`;
      const config = parseConfig(yaml);
      expect(config.network).toBeDefined();
      expect(config.network!.port).toBe(9900);
      expect(config.network!.pin).toBe('1234');
      expect(config.network!.hostName).toBe('My MIDI Mapper');
    });

    it('parses config with partial network section (port only)', () => {
      const yaml = `
deviceName: "Out"
rules:
  - cc: 1
    label: "X"
    inputMin: 0
    inputMax: 127
    outputMin: 0
    outputMax: 127
    curve: linear
network:
  port: 8080
`;
      const config = parseConfig(yaml);
      expect(config.network).toBeDefined();
      expect(config.network!.port).toBe(8080);
      expect(config.network!.pin).toBeUndefined();
      expect(config.network!.hostName).toBeUndefined();
    });

    it('parses config without network section (backward compat)', () => {
      const yaml = `
deviceName: "Out"
rules:
  - cc: 1
    label: "X"
    inputMin: 0
    inputMax: 127
    outputMin: 0
    outputMax: 127
    curve: linear
`;
      const config = parseConfig(yaml);
      expect(config.network).toBeUndefined();
    });
  });

  describe('invalid network section', () => {
    const makeNetworkYaml = (networkSection: string) => `
deviceName: "Out"
rules:
  - cc: 1
    label: "X"
    inputMin: 0
    inputMax: 127
    outputMin: 0
    outputMax: 127
    curve: linear
network:
  ${networkSection}
`;

    it('throws when network.port is negative', () => {
      expect(() => parseConfig(makeNetworkYaml('port: -1'))).toThrow(/network\.port/);
    });

    it('throws when network.port is zero', () => {
      expect(() => parseConfig(makeNetworkYaml('port: 0'))).toThrow(/network\.port/);
    });

    it('throws when network.port is > 65535', () => {
      expect(() => parseConfig(makeNetworkYaml('port: 65536'))).toThrow(/network\.port/);
    });

    it('throws when network.port is non-integer', () => {
      expect(() => parseConfig(makeNetworkYaml('port: 99.5'))).toThrow(/network\.port/);
    });

    it('throws when network.pin is not 4 chars (too short)', () => {
      expect(() => parseConfig(makeNetworkYaml('pin: "12"'))).toThrow(/network\.pin/);
    });

    it('throws when network.pin is not 4 chars (too long)', () => {
      expect(() => parseConfig(makeNetworkYaml('pin: "12345"'))).toThrow(/network\.pin/);
    });

    it('throws when network.pin is non-string', () => {
      expect(() => parseConfig(makeNetworkYaml('pin: 1234'))).toThrow(/network\.pin/);
    });

    it('throws when network.hostName is empty string', () => {
      expect(() => parseConfig(makeNetworkYaml('hostName: ""'))).toThrow(/network\.hostName/);
    });

    it('throws when network is not an object', () => {
      const yaml = `
deviceName: "Out"
rules:
  - cc: 1
    label: "X"
    inputMin: 0
    inputMax: 127
    outputMin: 0
    outputMax: 127
    curve: linear
network: "not an object"
`;
      expect(() => parseConfig(yaml)).toThrow(/network/);
    });
  });

  describe('invalid macros', () => {
    const baseMacroYaml = (macroSection: string) => `
deviceName: "Out"
rules:
  - cc: 1
    label: "X"
    inputMin: 0
    inputMax: 127
    outputMin: 0
    outputMax: 127
    curve: linear
macros:
${macroSection}
`;

    it('throws when macros is not an array', () => {
      const yaml = `
deviceName: "Out"
rules:
  - cc: 1
    label: "X"
    inputMin: 0
    inputMax: 127
    outputMin: 0
    outputMax: 127
    curve: linear
macros: "not an array"
`;
      expect(() => parseConfig(yaml)).toThrow(/macros/);
    });

    it('throws when macro is not an object', () => {
      expect(() => parseConfig(baseMacroYaml('  - "just a string"'))).toThrow(/macro\[0\]/);
    });

    it('throws when macro input is missing', () => {
      expect(() => parseConfig(baseMacroYaml(`  - label: "M"
    outputs:
      - cc: 20
        label: "O"
        outputMin: 0
        outputMax: 127
        curve: linear`))).toThrow(/macro\[0\].*input/);
    });

    it('throws when macro input is not an integer 0-127', () => {
      expect(() => parseConfig(baseMacroYaml(`  - input: 200
    label: "M"
    outputs:
      - cc: 20
        label: "O"
        outputMin: 0
        outputMax: 127
        curve: linear`))).toThrow(/macro\[0\].*input/);
    });

    it('throws when macro input is not an integer', () => {
      expect(() => parseConfig(baseMacroYaml(`  - input: 1.5
    label: "M"
    outputs:
      - cc: 20
        label: "O"
        outputMin: 0
        outputMax: 127
        curve: linear`))).toThrow(/macro\[0\].*input/);
    });

    it('throws when macro label is missing', () => {
      expect(() => parseConfig(baseMacroYaml(`  - input: 10
    outputs:
      - cc: 20
        label: "O"
        outputMin: 0
        outputMax: 127
        curve: linear`))).toThrow(/macro\[0\].*label/);
    });

    it('throws when macro label is not a string', () => {
      expect(() => parseConfig(baseMacroYaml(`  - input: 10
    label: 123
    outputs:
      - cc: 20
        label: "O"
        outputMin: 0
        outputMax: 127
        curve: linear`))).toThrow(/macro\[0\].*label/);
    });

    it('throws when macro outputs is missing', () => {
      expect(() => parseConfig(baseMacroYaml(`  - input: 10
    label: "M"`))).toThrow(/macro\[0\].*outputs/);
    });

    it('throws when macro outputs is empty', () => {
      expect(() => parseConfig(baseMacroYaml(`  - input: 10
    label: "M"
    outputs: []`))).toThrow(/macro\[0\].*outputs/);
    });

    it('throws when macro output is not an object', () => {
      expect(() => parseConfig(baseMacroYaml(`  - input: 10
    label: "M"
    outputs:
      - "not an object"`))).toThrow(/macro\[0\]\.outputs\[0\]/);
    });

    it('throws when macro output cc is invalid', () => {
      expect(() => parseConfig(baseMacroYaml(`  - input: 10
    label: "M"
    outputs:
      - cc: 200
        label: "O"
        outputMin: 0
        outputMax: 127
        curve: linear`))).toThrow(/macro\[0\]\.outputs\[0\].*cc/);
    });

    it('throws when macro output cc is not an integer', () => {
      expect(() => parseConfig(baseMacroYaml(`  - input: 10
    label: "M"
    outputs:
      - cc: 1.5
        label: "O"
        outputMin: 0
        outputMax: 127
        curve: linear`))).toThrow(/macro\[0\]\.outputs\[0\].*cc/);
    });

    it('throws when macro output label is missing', () => {
      expect(() => parseConfig(baseMacroYaml(`  - input: 10
    label: "M"
    outputs:
      - cc: 20
        outputMin: 0
        outputMax: 127
        curve: linear`))).toThrow(/macro\[0\]\.outputs\[0\].*label/);
    });

    it('throws when macro output outputMin is not a number', () => {
      expect(() => parseConfig(baseMacroYaml(`  - input: 10
    label: "M"
    outputs:
      - cc: 20
        label: "O"
        outputMin: "zero"
        outputMax: 127
        curve: linear`))).toThrow(/macro\[0\]\.outputs\[0\].*outputMin/);
    });

    it('throws when macro output outputMax is not a number', () => {
      expect(() => parseConfig(baseMacroYaml(`  - input: 10
    label: "M"
    outputs:
      - cc: 20
        label: "O"
        outputMin: 0
        outputMax: "max"
        curve: linear`))).toThrow(/macro\[0\]\.outputs\[0\].*outputMax/);
    });

    it('throws when macro output curve is invalid', () => {
      expect(() => parseConfig(baseMacroYaml(`  - input: 10
    label: "M"
    outputs:
      - cc: 20
        label: "O"
        outputMin: 0
        outputMax: 127
        curve: quadratic`))).toThrow(/macro\[0\]\.outputs\[0\].*curve/);
    });

    it('throws when macro output invert is not a boolean', () => {
      expect(() => parseConfig(baseMacroYaml(`  - input: 10
    label: "M"
    outputs:
      - cc: 20
        label: "O"
        outputMin: 0
        outputMax: 127
        curve: linear
        invert: "yes"`))).toThrow(/macro\[0\]\.outputs\[0\].*invert/);
    });
  });
});

// ---------------------------------------------------------------------------
// YamlConfigAdapter.load()
// ---------------------------------------------------------------------------
describe('YamlConfigAdapter', () => {
  describe('load', () => {
    it('loads and parses a valid YAML file', async () => {
      const tmp = `/tmp/midi-mapper-adapter-test-${Date.now()}.yaml`;
      await Bun.write(tmp, `
deviceName: "File Test"
rules:
  - cc: 1
    label: "Mod Wheel"
    inputMin: 0
    inputMax: 127
    outputMin: 0
    outputMax: 127
    curve: linear
`);
      const adapter = new YamlConfigAdapter();
      const config = await adapter.load(tmp);
      expect(config.deviceName).toBe('File Test');
      expect(config.rules).toHaveLength(1);
      await unlink(tmp);
    });

    it('throws on non-existent file', async () => {
      const adapter = new YamlConfigAdapter();
      await expect(adapter.load('/tmp/nonexistent-midi-config-xyz.yaml')).rejects.toThrow();
    });

    it('throws on file with invalid config', async () => {
      const tmp = `/tmp/midi-mapper-adapter-test-invalid-${Date.now()}.yaml`;
      await Bun.write(tmp, 'deviceName: 123');
      const adapter = new YamlConfigAdapter();
      await expect(adapter.load(tmp)).rejects.toThrow(/deviceName/);
      await unlink(tmp);
    });
  });
});

// ---------------------------------------------------------------------------
// YamlConfigWriterAdapter.save()
// ---------------------------------------------------------------------------
describe('YamlConfigWriterAdapter', () => {
  const sampleConfig: AppConfig = {
    deviceName: 'Writer Test',
    rules: [
      {
        cc: 1,
        label: 'Mod Wheel',
        inputMin: 0,
        inputMax: 127,
        outputMin: 0,
        outputMax: 127,
        curve: 'linear',
      },
    ],
    macros: [
      {
        input: 10,
        label: 'Macro1',
        outputs: [
          { cc: 20, label: 'Out1', outputMin: 0, outputMax: 127, curve: 'exponential' },
        ],
      },
    ],
  };

  it('writes valid YAML that can be parsed back', async () => {
    const tmp = `/tmp/midi-mapper-writer-test-${Date.now()}.yaml`;
    const writer = new YamlConfigWriterAdapter();

    await writer.save(tmp, sampleConfig);

    const content = await Bun.file(tmp).text();
    const parsed = parseYaml(content) as AppConfig;
    expect(parsed.deviceName).toBe('Writer Test');
    expect(parsed.rules).toHaveLength(1);
    expect(parsed.rules[0]!.cc).toBe(1);
    expect(parsed.rules[0]!.curve).toBe('linear');
    expect(parsed.macros).toHaveLength(1);
    expect(parsed.macros![0]!.input).toBe(10);
    expect(parsed.macros![0]!.outputs[0]!.cc).toBe(20);
    await unlink(tmp);
  });

  it('creates file at specified path', async () => {
    const tmp = `/tmp/midi-mapper-writer-path-test-${Date.now()}.yaml`;
    const writer = new YamlConfigWriterAdapter();

    await writer.save(tmp, sampleConfig);

    const exists = await Bun.file(tmp).exists();
    expect(exists).toBe(true);
    await unlink(tmp);
  });
});
