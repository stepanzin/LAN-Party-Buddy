import { flow } from 'fp-ts/function';

import type { AppConfig } from '@domain/config';
import type { CompiledRule, CompiledRules, CompiledMacro, CompiledMacros } from '@domain/mapping-rule';
import { mapValueClampedCurried, mapValueLogClampedCurried, mapValueExponentialCurried, mapValueSCurveCurried } from '@domain/value-curves';

const CURVE_MAPPERS = {
  linear: mapValueClampedCurried,
  logarithmic: mapValueLogClampedCurried,
  exponential: mapValueExponentialCurried,
  's-curve': mapValueSCurveCurried,
} as const;

export function buildRules(config: AppConfig): CompiledRules {
  const result: Record<string, CompiledRule> = {};
  for (const rule of config.rules) {
    const inputMin = rule.deadZoneMin ?? rule.inputMin;
    const inputMax = rule.deadZoneMax ?? rule.inputMax;
    const [outMin, outMax] = rule.invert ? [rule.outputMax, rule.outputMin] : [rule.outputMin, rule.outputMax];

    result[rule.cc.toString()] = {
      transform: flow(
        CURVE_MAPPERS[rule.curve]([inputMin, inputMax], [outMin, outMax]),
        Math.round,
      ),
      smoothing: rule.smoothing ?? 0,
      mode: rule.mode ?? 'normal',
    };
  }
  return result;
}

export function buildMacros(config: AppConfig): CompiledMacros {
  if (!config.macros) return {};
  const result: Record<string, readonly CompiledMacro[]> = {};
  for (const macro of config.macros) {
    result[macro.input.toString()] = macro.outputs.map((out) => {
      const [outMin, outMax] = out.invert ? [out.outputMax, out.outputMin] : [out.outputMin, out.outputMax];
      return {
        outputCc: out.cc,
        transform: flow(
          CURVE_MAPPERS[out.curve]([0, 127], [outMin, outMax]),
          Math.round,
        ),
      };
    });
  }
  return result;
}
