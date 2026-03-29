import { parse as parseYaml } from 'yaml';
import type { ConfigReaderPort } from '../ports/config-reader.port';
import type { AppConfig, Curve, MacroConfig, MacroOutput, RuleConfig } from '../domain/config';

const VALID_CURVES: readonly Curve[] = ['linear', 'logarithmic', 'exponential', 's-curve'];
const VALID_MODES = ['normal', 'toggle'] as const;

function validateRule(raw: unknown, index: number): RuleConfig {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`rule[${index}]: must be an object`);
  }

  const r = raw as Record<string, unknown>;

  if (typeof r.cc !== 'number' || !Number.isInteger(r.cc) || r.cc < 0 || r.cc > 127) {
    throw new Error(`rule[${index}]: cc must be an integer 0-127`);
  }

  if (typeof r.label !== 'string') {
    throw new Error(`rule[${index}]: label must be a string`);
  }

  for (const field of ['inputMin', 'inputMax', 'outputMin', 'outputMax'] as const) {
    if (typeof r[field] !== 'number') {
      throw new Error(`rule[${index}]: ${field} must be a number`);
    }
  }

  if (!VALID_CURVES.includes(r.curve as Curve)) {
    throw new Error(`rule[${index}]: curve must be one of: ${VALID_CURVES.join(', ')}`);
  }

  // Optional fields
  if (r.smoothing !== undefined) {
    if (typeof r.smoothing !== 'number' || !Number.isInteger(r.smoothing) || r.smoothing < 0) {
      throw new Error(`rule[${index}]: smoothing must be a non-negative integer`);
    }
  }

  if (r.invert !== undefined) {
    if (typeof r.invert !== 'boolean') {
      throw new Error(`rule[${index}]: invert must be a boolean`);
    }
  }

  if (r.mode !== undefined) {
    if (typeof r.mode !== 'string' || !(VALID_MODES as readonly string[]).includes(r.mode)) {
      throw new Error(`rule[${index}]: mode must be one of: ${VALID_MODES.join(', ')}`);
    }
  }

  if (r.deadZoneMin !== undefined) {
    if (typeof r.deadZoneMin !== 'number') {
      throw new Error(`rule[${index}]: deadZoneMin must be a number`);
    }
  }

  if (r.deadZoneMax !== undefined) {
    if (typeof r.deadZoneMax !== 'number') {
      throw new Error(`rule[${index}]: deadZoneMax must be a number`);
    }
  }

  const result: RuleConfig = {
    cc: r.cc as number,
    label: r.label as string,
    inputMin: r.inputMin as number,
    inputMax: r.inputMax as number,
    outputMin: r.outputMin as number,
    outputMax: r.outputMax as number,
    curve: r.curve as Curve,
  };

  if (r.smoothing !== undefined) (result as Record<string, unknown>).smoothing = r.smoothing;
  if (r.invert !== undefined) (result as Record<string, unknown>).invert = r.invert;
  if (r.mode !== undefined) (result as Record<string, unknown>).mode = r.mode;
  if (r.deadZoneMin !== undefined) (result as Record<string, unknown>).deadZoneMin = r.deadZoneMin;
  if (r.deadZoneMax !== undefined) (result as Record<string, unknown>).deadZoneMax = r.deadZoneMax;

  return result;
}

function validateMacroOutput(raw: unknown, macroIndex: number, outputIndex: number): MacroOutput {
  const prefix = `macro[${macroIndex}].outputs[${outputIndex}]`;

  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`${prefix}: must be an object`);
  }

  const o = raw as Record<string, unknown>;

  if (typeof o.cc !== 'number' || !Number.isInteger(o.cc) || o.cc < 0 || o.cc > 127) {
    throw new Error(`${prefix}: cc must be an integer 0-127`);
  }

  if (typeof o.label !== 'string') {
    throw new Error(`${prefix}: label must be a string`);
  }

  if (typeof o.outputMin !== 'number') {
    throw new Error(`${prefix}: outputMin must be a number`);
  }

  if (typeof o.outputMax !== 'number') {
    throw new Error(`${prefix}: outputMax must be a number`);
  }

  if (!VALID_CURVES.includes(o.curve as Curve)) {
    throw new Error(`${prefix}: curve must be one of: ${VALID_CURVES.join(', ')}`);
  }

  if (o.invert !== undefined) {
    if (typeof o.invert !== 'boolean') {
      throw new Error(`${prefix}: invert must be a boolean`);
    }
  }

  const result: MacroOutput = {
    cc: o.cc as number,
    label: o.label as string,
    outputMin: o.outputMin as number,
    outputMax: o.outputMax as number,
    curve: o.curve as Curve,
  };

  if (o.invert !== undefined) (result as Record<string, unknown>).invert = o.invert;

  return result;
}

function validateMacro(raw: unknown, index: number): MacroConfig {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`macro[${index}]: must be an object`);
  }

  const m = raw as Record<string, unknown>;

  if (typeof m.input !== 'number' || !Number.isInteger(m.input) || m.input < 0 || m.input > 127) {
    throw new Error(`macro[${index}]: input must be an integer 0-127`);
  }

  if (typeof m.label !== 'string') {
    throw new Error(`macro[${index}]: label must be a string`);
  }

  if (!Array.isArray(m.outputs)) {
    throw new Error(`macro[${index}]: outputs must be an array`);
  }

  if (m.outputs.length === 0) {
    throw new Error(`macro[${index}]: outputs must not be empty`);
  }

  const outputs = m.outputs.map((raw: unknown, i: number) => validateMacroOutput(raw, index, i));

  return {
    input: m.input as number,
    label: m.label as string,
    outputs,
  };
}

export function parseConfig(yamlContent: string): AppConfig {
  let doc: unknown;
  try {
    doc = parseYaml(yamlContent);
  } catch {
    throw new Error('Invalid YAML syntax');
  }

  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
    throw new Error('Config must be a YAML mapping');
  }

  const obj = doc as Record<string, unknown>;

  if (typeof obj.deviceName !== 'string' || obj.deviceName.length === 0) {
    throw new Error('deviceName must be a non-empty string');
  }

  if (!Array.isArray(obj.rules)) {
    throw new Error('rules must be an array');
  }

  if (obj.rules.length === 0) {
    throw new Error('rules must not be empty');
  }

  const rules = obj.rules.map((raw: unknown, i: number) => validateRule(raw, i));

  const result: AppConfig = {
    deviceName: obj.deviceName,
    rules,
  };

  if (obj.macros !== undefined) {
    if (!Array.isArray(obj.macros)) {
      throw new Error('macros must be an array');
    }
    (result as Record<string, unknown>).macros = obj.macros.map((raw: unknown, i: number) => validateMacro(raw, i));
  }

  return result;
}

export class YamlConfigAdapter implements ConfigReaderPort {
  async load(source: string): Promise<AppConfig> {
    const content = await Bun.file(source).text();
    return parseConfig(content);
  }
}
