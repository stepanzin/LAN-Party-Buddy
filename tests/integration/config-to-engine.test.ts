import { describe, it, expect } from 'bun:test';
import { resolve } from 'node:path';

import { YamlConfigAdapter, parseConfig } from '@adapters/yaml-config.adapter';
import { buildRules, buildMacros } from '@app/rule-compiler';
import { processMidiMessage, INITIAL_ENGINE_STATE, type EngineState } from '@domain/mapping-engine';
import type { MidiCC } from '@domain/midi-message';
import type { AppConfig } from '@domain/config';

const CONFIG_PATH = resolve(import.meta.dir, '../../config.yaml');

describe('Integration: Config -> Rule Compiler -> Engine', () => {
  it('processes expression pedal CC through full pipeline with real config.yaml', async () => {
    // Load the real config.yaml via YamlConfigAdapter
    const adapter = new YamlConfigAdapter();
    const config = await adapter.load(CONFIG_PATH);

    const rules = buildRules(config);
    const macros = buildMacros(config);

    // CC 4 (left pedal): inputMin=40, inputMax=127, outputMin=0, outputMax=127, linear
    // value=80 -> t = (80-40)/(127-40) = 40/87 -> output = 0 + (40/87)*127
    const msg: MidiCC = { channel: 0, cc: 4, value: 80 };
    const { result } = processMidiMessage(msg, rules, macros, INITIAL_ENGINE_STATE);

    const expectedT = (80 - 40) / (127 - 40);
    const expectedOutput = Math.round(0 + expectedT * 127);

    expect(result.log.cc).toBe(4);
    expect(result.log.originalValue).toBe(80);
    expect(result.log.mappedValue).toBe(expectedOutput);

    // Main output message is the last one (after NRPN preamble)
    const mainMsg = result.outputMessages[result.outputMessages.length - 1];
    expect(mainMsg).toEqual([0xb0, 4, expectedOutput]);
  });

  it('processes CC with smoothing enabled through multiple messages', async () => {
    // CC 4 in the real config has smoothing: 3
    const adapter = new YamlConfigAdapter();
    const config = await adapter.load(CONFIG_PATH);

    const rules = buildRules(config);
    const macros = buildMacros(config);

    let state: EngineState = INITIAL_ENGINE_STATE;

    // Send 3 messages for CC 4 with values 60, 90, 120
    const r1 = processMidiMessage({ channel: 0, cc: 4, value: 60 }, rules, macros, state);
    state = r1.nextState;
    // Buffer: [60], average = 60, then mapped through linear [40,127]->[0,127]
    const expected1 = Math.round(((60 - 40) / (127 - 40)) * 127);
    expect(r1.result.log.mappedValue).toBe(expected1);

    const r2 = processMidiMessage({ channel: 0, cc: 4, value: 90 }, rules, macros, state);
    state = r2.nextState;
    // Buffer: [60, 90], average = 75
    const avg2 = Math.round((60 + 90) / 2);
    const expected2 = Math.round(((avg2 - 40) / (127 - 40)) * 127);
    expect(r2.result.log.mappedValue).toBe(expected2);

    const r3 = processMidiMessage({ channel: 0, cc: 4, value: 120 }, rules, macros, state);
    state = r3.nextState;
    // Buffer: [60, 90, 120], average = 90
    const avg3 = Math.round((60 + 90 + 120) / 3);
    const expected3 = Math.round(((avg3 - 40) / (127 - 40)) * 127);
    expect(r3.result.log.mappedValue).toBe(expected3);
  });

  it('processes toggle mode through press/release cycle', async () => {
    // CC 64 in the real config has mode: toggle, linear [0,127]->[0,127]
    const adapter = new YamlConfigAdapter();
    const config = await adapter.load(CONFIG_PATH);

    const rules = buildRules(config);
    const macros = buildMacros(config);

    let state: EngineState = INITIAL_ENGINE_STATE;

    // Press (value=127): toggle flips false->true, outputs transform(127)=127
    const r1 = processMidiMessage({ channel: 0, cc: 64, value: 127 }, rules, macros, state);
    state = r1.nextState;
    expect(r1.result.log.mappedValue).toBe(127);
    expect(state.toggleStates['64']).toBe(true);

    // Release (value=0): no flip, toggle stays true, outputs transform(127)=127
    const r2 = processMidiMessage({ channel: 0, cc: 64, value: 0 }, rules, macros, state);
    state = r2.nextState;
    expect(r2.result.log.mappedValue).toBe(127);
    expect(state.toggleStates['64']).toBe(true);

    // Press again (value=127): toggle flips true->false, outputs transform(0)=0
    const r3 = processMidiMessage({ channel: 0, cc: 64, value: 127 }, rules, macros, state);
    state = r3.nextState;
    expect(r3.result.log.mappedValue).toBe(0);
    expect(state.toggleStates['64']).toBe(false);
  });

  it('processes macro through full pipeline', () => {
    // Build a config with a macro: CC 1 input -> CC 74 and CC 71 outputs
    const config: AppConfig = {
      deviceName: 'Test',
      rules: [
        { cc: 1, label: 'Mod Wheel', inputMin: 0, inputMax: 127, outputMin: 0, outputMax: 127, curve: 'linear' },
      ],
      macros: [
        {
          input: 1,
          label: 'Performance Macro',
          outputs: [
            { cc: 74, label: 'Filter Cutoff', outputMin: 0, outputMax: 127, curve: 'exponential' },
            { cc: 71, label: 'Resonance', outputMin: 100, outputMax: 20, curve: 'linear', invert: true },
          ],
        },
      ],
    };

    const rules = buildRules(config);
    const macros = buildMacros(config);

    const msg: MidiCC = { channel: 0, cc: 1, value: 64 };
    const { result } = processMidiMessage(msg, rules, macros, INITIAL_ENGINE_STATE);

    // We expect: NRPN preamble (2) + main rule output (1) + 2 macro outputs = 5
    expect(result.outputMessages.length).toBe(5);

    // Main message: linear [0,127]->[0,127], value 64 -> 64
    expect(result.outputMessages[2]).toEqual([0xb0, 1, 64]);

    // Macro output 1: CC 74, exponential [0,127]->[0,127]
    // t = 64/127, exponential: t^2 * 127
    const t = 64 / 127;
    const expOutput = Math.round(127 * t * t);
    expect(result.outputMessages[3]).toEqual([0xb0, 74, expOutput]);

    // Macro output 2: CC 71, linear [0,127]->[100,20] with invert -> [20,100]
    // Wait: invert swaps outputMin/outputMax. Config has outputMin=100, outputMax=20, invert=true
    // So effective: [20, 100]. t = 64/127 -> output = 20 + (64/127)*(100-20) = 20 + 40.31 = 60
    const linearOutput = Math.round(20 + (64 / 127) * (100 - 20));
    expect(result.outputMessages[4]).toEqual([0xb0, 71, linearOutput]);
  });

  it('processes exponential curve correctly end-to-end', () => {
    const config: AppConfig = {
      deviceName: 'Test',
      rules: [
        { cc: 10, label: 'Exp Test', inputMin: 0, inputMax: 127, outputMin: 0, outputMax: 127, curve: 'exponential' },
      ],
    };

    const rules = buildRules(config);
    const macros = buildMacros(config);

    // Midpoint input value
    const msg: MidiCC = { channel: 0, cc: 10, value: 64 };
    const { result: expResult } = processMidiMessage(msg, rules, macros, INITIAL_ENGINE_STATE);

    // With exponential curve, midpoint (t~0.5) should produce t^2 * 127 ~ 0.25 * 127 ~ 32
    // This should be LESS than linear midpoint (64)
    expect(expResult.log.mappedValue).toBeLessThan(64);

    // Also verify the exact value: t = 64/127, output = 127 * t^2
    const t = 64 / 127;
    const expected = Math.round(127 * t * t);
    expect(expResult.log.mappedValue).toBe(expected);
  });

  it('processes s-curve correctly end-to-end', () => {
    const config: AppConfig = {
      deviceName: 'Test',
      rules: [
        { cc: 10, label: 'S-Curve Test', inputMin: 0, inputMax: 127, outputMin: 0, outputMax: 127, curve: 's-curve' },
      ],
    };

    const rules = buildRules(config);
    const macros = buildMacros(config);

    // Midpoint input
    const msg: MidiCC = { channel: 0, cc: 10, value: 64 };
    const { result } = processMidiMessage(msg, rules, macros, INITIAL_ENGINE_STATE);

    // S-curve at midpoint (t~0.5): 3t^2 - 2t^3 = 3*0.25 - 2*0.125 = 0.75 - 0.25 = 0.5
    // So the output at midpoint should be approximately the midpoint output (symmetric)
    const t = 64 / 127;
    const expected = Math.round(127 * (3 * t * t - 2 * t * t * t));
    expect(result.log.mappedValue).toBe(expected);

    // The midpoint should be close to the linear midpoint (symmetric property)
    expect(Math.abs(result.log.mappedValue - 64)).toBeLessThanOrEqual(1);
  });

  it('inversion reverses output direction', () => {
    const config: AppConfig = {
      deviceName: 'Test',
      rules: [
        { cc: 10, label: 'Inverted', inputMin: 0, inputMax: 127, outputMin: 0, outputMax: 127, curve: 'linear', invert: true },
      ],
    };

    const rules = buildRules(config);
    const macros = buildMacros(config);

    // Value at inputMin (0) should map to outputMax (127) because invert swaps output range
    const msgMin: MidiCC = { channel: 0, cc: 10, value: 0 };
    const { result: rMin } = processMidiMessage(msgMin, rules, macros, INITIAL_ENGINE_STATE);
    expect(rMin.log.mappedValue).toBe(127);

    // Value at inputMax (127) should map to outputMin (0)
    const msgMax: MidiCC = { channel: 0, cc: 10, value: 127 };
    const { result: rMax } = processMidiMessage(msgMax, rules, macros, INITIAL_ENGINE_STATE);
    expect(rMax.log.mappedValue).toBe(0);
  });

  it('dead zone overrides input range', () => {
    const config: AppConfig = {
      deviceName: 'Test',
      rules: [
        {
          cc: 10,
          label: 'Dead Zone Test',
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
    const macros = buildMacros(config);

    // Value below deadZoneMin should map to outputMin
    const msgLow: MidiCC = { channel: 0, cc: 10, value: 10 };
    const { result: rLow } = processMidiMessage(msgLow, rules, macros, INITIAL_ENGINE_STATE);
    expect(rLow.log.mappedValue).toBe(0);

    // Value above deadZoneMax should map to outputMax
    const msgHigh: MidiCC = { channel: 0, cc: 10, value: 110 };
    const { result: rHigh } = processMidiMessage(msgHigh, rules, macros, INITIAL_ENGINE_STATE);
    expect(rHigh.log.mappedValue).toBe(127);

    // Value in the middle of the dead zone range should map proportionally
    const msgMid: MidiCC = { channel: 0, cc: 10, value: 60 };
    const { result: rMid } = processMidiMessage(msgMid, rules, macros, INITIAL_ENGINE_STATE);
    const expectedMid = Math.round(((60 - 20) / (100 - 20)) * 127);
    expect(rMid.log.mappedValue).toBe(expectedMid);
  });

  it('right expression pedal maps to reduced output range', async () => {
    // CC 5 in real config: inputMin=40, inputMax=120, outputMin=0, outputMax=64, linear
    const adapter = new YamlConfigAdapter();
    const config = await adapter.load(CONFIG_PATH);

    const rules = buildRules(config);
    const macros = buildMacros(config);

    const msg: MidiCC = { channel: 0, cc: 5, value: 80 };
    const { result } = processMidiMessage(msg, rules, macros, INITIAL_ENGINE_STATE);

    const expectedT = (80 - 40) / (120 - 40);
    const expectedOutput = Math.round(0 + expectedT * 64);
    expect(result.log.mappedValue).toBe(expectedOutput);
  });

  it('values below inputMin clamp to outputMin in real config', async () => {
    const adapter = new YamlConfigAdapter();
    const config = await adapter.load(CONFIG_PATH);

    const rules = buildRules(config);
    const macros = buildMacros(config);

    // CC 4 with value below inputMin (40)
    const msg: MidiCC = { channel: 0, cc: 4, value: 10 };
    const { result } = processMidiMessage(msg, rules, macros, INITIAL_ENGINE_STATE);

    expect(result.log.mappedValue).toBe(0);
  });

  it('values above inputMax clamp to outputMax in real config', async () => {
    const adapter = new YamlConfigAdapter();
    const config = await adapter.load(CONFIG_PATH);

    const rules = buildRules(config);
    const macros = buildMacros(config);

    // CC 4 with value at inputMax (127)
    const msg: MidiCC = { channel: 0, cc: 4, value: 127 };
    const { result } = processMidiMessage(msg, rules, macros, INITIAL_ENGINE_STATE);

    expect(result.log.mappedValue).toBe(127);
  });

  it('parseConfig + buildRules round-trip preserves all rules from YAML', async () => {
    const adapter = new YamlConfigAdapter();
    const config = await adapter.load(CONFIG_PATH);

    const rules = buildRules(config);

    // Real config has 3 rules: CC 4, CC 5, CC 64
    expect(rules['4']).toBeDefined();
    expect(rules['5']).toBeDefined();
    expect(rules['64']).toBeDefined();

    // CC 64 should be toggle mode
    expect(rules['64']!.mode).toBe('toggle');

    // CC 4 should have smoothing 3
    expect(rules['4']!.smoothing).toBe(3);

    // CC 5 should have no smoothing
    expect(rules['5']!.smoothing).toBe(0);
  });
});
