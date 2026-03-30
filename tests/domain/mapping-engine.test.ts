import { describe, expect, it } from 'bun:test';

import { type EngineState, INITIAL_ENGINE_STATE, processMidiMessage } from '@domain/mapping-engine';
import type { CompiledMacros, CompiledRule, CompiledRules } from '@domain/mapping-rule';
import type { MidiCC } from '@domain/midi-message';

// Helper to build a CompiledRule with defaults
const rule = (
  transform: (v: number) => number,
  opts?: { smoothing?: number; mode?: 'normal' | 'toggle' },
): CompiledRule => ({
  transform,
  smoothing: opts?.smoothing ?? 0,
  mode: opts?.mode ?? 'normal',
});

describe('processMidiMessage', () => {
  // Helpers
  const status = (ch: number) => 0xb0 + ch;

  // --- Normal mapping ---

  it('applies linear rule and returns mapped value', () => {
    const msg: MidiCC = { channel: 0, cc: 10, value: 64 };
    const rules: CompiledRules = { '10': rule((v) => v * 2) };

    const { result, nextState } = processMidiMessage(msg, rules, {}, INITIAL_ENGINE_STATE);

    // clampMidi(128) = 127, so mappedValue in log is the clamped result
    expect(result.log.mappedValue).toBe(127);
    expect(result.log.matched).toBe(true);
    expect(result.log.macroOutputs).toEqual([]);
    const mainMsg = result.outputMessages[result.outputMessages.length - 1];
    expect(mainMsg).toEqual([status(0), 10, 127]);
  });

  it('applies logarithmic rule (mock function as rule)', () => {
    const logRule = (v: number) => Math.log1p(v) * 20;
    const msg: MidiCC = { channel: 1, cc: 20, value: 50 };
    const rules: CompiledRules = { '20': rule(logRule) };

    const { result } = processMidiMessage(msg, rules, {}, INITIAL_ENGINE_STATE);

    const expected = Math.max(0, Math.min(127, Math.round(Math.log1p(50) * 20)));
    const mainMsg = result.outputMessages[result.outputMessages.length - 1];
    expect(mainMsg).toEqual([status(1), 20, expected]);
    expect(result.log.mappedValue).toBe(expected);
    expect(result.log.matched).toBe(true);
    expect(result.log.macroOutputs).toEqual([]);
  });

  it('clamps mapped value to 0-127 range (above 127)', () => {
    const msg: MidiCC = { channel: 0, cc: 5, value: 100 };
    const rules: CompiledRules = { '5': rule((v) => v * 10) }; // 1000

    const { result } = processMidiMessage(msg, rules, {}, INITIAL_ENGINE_STATE);

    const mainMsg = result.outputMessages[result.outputMessages.length - 1];
    expect(mainMsg).toEqual([status(0), 5, 127]);
    expect(result.log.mappedValue).toBe(127);
    expect(result.log.matched).toBe(true);
    expect(result.log.macroOutputs).toEqual([]);
  });

  it('clamps mapped value to 0 when below 0', () => {
    const msg: MidiCC = { channel: 0, cc: 5, value: 10 };
    const rules: CompiledRules = { '5': rule((_v) => -50) };

    const { result } = processMidiMessage(msg, rules, {}, INITIAL_ENGINE_STATE);

    const mainMsg = result.outputMessages[result.outputMessages.length - 1];
    expect(mainMsg).toEqual([status(0), 5, 0]);
    expect(result.log.mappedValue).toBe(0);
    expect(result.log.matched).toBe(true);
    expect(result.log.macroOutputs).toEqual([]);
  });

  // --- CC 49 special case ---

  it('prepends NRPN messages [status, 99, 0] and [status, 100, 127] when cc is 49', () => {
    const msg: MidiCC = { channel: 0, cc: 49, value: 64 };
    const rules: CompiledRules = { '49': rule((v) => v) };

    const { result } = processMidiMessage(msg, rules, {}, INITIAL_ENGINE_STATE);

    expect(result.outputMessages[0]).toEqual([status(0), 99, 0]);
    expect(result.outputMessages[1]).toEqual([status(0), 100, 127]);
    expect(result.log.matched).toBe(true);
    expect(result.log.macroOutputs).toEqual([]);
  });

  it('prepends [status, 99, 127] and [status, 100, 0] for any other cc', () => {
    const msg: MidiCC = { channel: 2, cc: 10, value: 64 };
    const rules: CompiledRules = { '10': rule((v) => v) };

    const { result } = processMidiMessage(msg, rules, {}, INITIAL_ENGINE_STATE);

    expect(result.outputMessages[0]).toEqual([status(2), 99, 127]);
    expect(result.outputMessages[1]).toEqual([status(2), 100, 0]);
    expect(result.log.matched).toBe(true);
    expect(result.log.macroOutputs).toEqual([]);
  });

  // --- prevCode / state management ---

  it('updates prevCode in nextState when no rule matches', () => {
    const msg: MidiCC = { channel: 0, cc: 77, value: 50 };
    const rules: CompiledRules = {}; // no rules

    const { result, nextState } = processMidiMessage(msg, rules, {}, INITIAL_ENGINE_STATE);

    expect(nextState.prevCode).toBe(77);
    expect(result.log.matched).toBe(false);
    expect(result.log.macroOutputs).toEqual([]);
  });

  it('emits [status, prevCode, 0] when prevCode was set and new unmapped cc arrives', () => {
    const msg: MidiCC = { channel: 0, cc: 88, value: 30 };
    const rules: CompiledRules = {};
    const state: EngineState = { prevCode: 55, smoothingBuffers: {}, toggleStates: {} };

    const { result } = processMidiMessage(msg, rules, {}, state);

    // After NRPN preamble (indices 0 and 1), prevCode reset should be at index 2
    expect(result.outputMessages[2]).toEqual([status(0), 55, 0]);
    expect(result.log.matched).toBe(false);
    expect(result.log.macroOutputs).toEqual([]);
  });

  it('does NOT emit prevCode message when prevCode is null', () => {
    const msg: MidiCC = { channel: 0, cc: 88, value: 30 };
    const rules: CompiledRules = {};
    const state: EngineState = { prevCode: null, smoothingBuffers: {}, toggleStates: {} };

    const { result } = processMidiMessage(msg, rules, {}, state);

    // Should be: NRPN preamble (2 msgs) + main message = 3 total
    expect(result.outputMessages.length).toBe(3);
    expect(result.log.matched).toBe(false);
    expect(result.log.macroOutputs).toEqual([]);
  });

  it('resets prevCode tracking on each new unmapped message', () => {
    const rules: CompiledRules = {};

    // First unmapped message
    const { nextState: state1 } = processMidiMessage(
      { channel: 0, cc: 10, value: 50 },
      rules,
      {},
      INITIAL_ENGINE_STATE,
    );
    expect(state1.prevCode).toBe(10);

    // Second unmapped message - prevCode should now be 20
    const { nextState: state2 } = processMidiMessage({ channel: 0, cc: 20, value: 60 }, rules, {}, state1);
    expect(state2.prevCode).toBe(20);
  });

  // --- Output message ordering ---

  it('output order: NRPN preamble -> prevCode reset (if any) -> main mapped message', () => {
    const msg: MidiCC = { channel: 0, cc: 33, value: 100 };
    const rules: CompiledRules = {}; // no rule => unmapped path
    const state: EngineState = { prevCode: 22, smoothingBuffers: {}, toggleStates: {} };

    const { result } = processMidiMessage(msg, rules, {}, state);

    // Non-49 cc => [status, 99, 127], [status, 100, 0]
    expect(result.outputMessages[0]).toEqual([status(0), 99, 127]);
    expect(result.outputMessages[1]).toEqual([status(0), 100, 0]);
    // prevCode reset
    expect(result.outputMessages[2]).toEqual([status(0), 22, 0]);
    // main message last
    expect(result.outputMessages[3]).toEqual([status(0), 33, 100]);
    expect(result.outputMessages.length).toBe(4);
    expect(result.log.matched).toBe(false);
    expect(result.log.macroOutputs).toEqual([]);
  });

  it('output order with mapped rule: NRPN preamble -> main mapped message (no prevCode reset)', () => {
    const msg: MidiCC = { channel: 0, cc: 33, value: 100 };
    const rules: CompiledRules = { '33': rule((v) => v / 2) };
    const state: EngineState = { prevCode: 22, smoothingBuffers: {}, toggleStates: {} };

    const { result } = processMidiMessage(msg, rules, {}, state);

    // Non-49 cc => [status, 99, 127], [status, 100, 0]
    expect(result.outputMessages[0]).toEqual([status(0), 99, 127]);
    expect(result.outputMessages[1]).toEqual([status(0), 100, 0]);
    // main message (no prevCode reset since rule matched)
    expect(result.outputMessages[2]).toEqual([status(0), 33, 50]);
    expect(result.outputMessages.length).toBe(3);
    expect(result.log.matched).toBe(true);
    expect(result.log.macroOutputs).toEqual([]);
  });

  // --- INITIAL_ENGINE_STATE ---

  it('has prevCode as null', () => {
    expect(INITIAL_ENGINE_STATE.prevCode).toBeNull();
  });

  it('has empty smoothingBuffers', () => {
    expect(INITIAL_ENGINE_STATE.smoothingBuffers).toEqual({});
  });

  it('has empty toggleStates', () => {
    expect(INITIAL_ENGINE_STATE.toggleStates).toEqual({});
  });

  // --- Log info ---

  it('returns correct log with cc, originalValue, mappedValue', () => {
    const msg: MidiCC = { channel: 0, cc: 15, value: 80 };
    const rules: CompiledRules = { '15': rule((v) => v + 10) };

    const { result } = processMidiMessage(msg, rules, {}, INITIAL_ENGINE_STATE);

    expect(result.log.cc).toBe(15);
    expect(result.log.originalValue).toBe(80);
    expect(result.log.mappedValue).toBe(90);
    expect(result.log.matched).toBe(true);
    expect(result.log.macroOutputs).toEqual([]);
  });

  it('log shows original value even when mapped', () => {
    const msg: MidiCC = { channel: 0, cc: 7, value: 100 };
    const rules: CompiledRules = { '7': rule((_v) => 42) };

    const { result } = processMidiMessage(msg, rules, {}, INITIAL_ENGINE_STATE);

    expect(result.log.originalValue).toBe(100);
    expect(result.log.mappedValue).toBe(42);
    expect(result.log.cc).toBe(7);
    expect(result.log.matched).toBe(true);
    expect(result.log.macroOutputs).toEqual([]);
  });

  // --- State is not mutated when rule matches ---

  it('does not update prevCode when a rule matches', () => {
    const msg: MidiCC = { channel: 0, cc: 10, value: 64 };
    const rules: CompiledRules = { '10': rule((v) => v) };
    const state: EngineState = { prevCode: 5, smoothingBuffers: {}, toggleStates: {} };

    const { result, nextState } = processMidiMessage(msg, rules, {}, state);

    // prevCode should remain unchanged when a rule matched
    expect(nextState.prevCode).toBe(5);
    expect(result.log.matched).toBe(true);
    expect(result.log.macroOutputs).toEqual([]);
  });
});

describe('smoothing', () => {
  const status = (ch: number) => 0xb0 + ch;

  it('applies smoothing with window size 3', () => {
    const rules: CompiledRules = { '10': rule((v) => v, { smoothing: 3 }) };

    // Send 3 values: 60, 90, 120 => average = 90
    let state = INITIAL_ENGINE_STATE;

    const r1 = processMidiMessage({ channel: 0, cc: 10, value: 60 }, rules, {}, state);
    state = r1.nextState;
    // Average of [60] = 60
    expect(r1.result.log.mappedValue).toBe(60);
    expect(r1.result.log.matched).toBe(true);
    expect(r1.result.log.macroOutputs).toEqual([]);

    const r2 = processMidiMessage({ channel: 0, cc: 10, value: 90 }, rules, {}, state);
    state = r2.nextState;
    // Average of [60, 90] = 75
    expect(r2.result.log.mappedValue).toBe(75);
    expect(r2.result.log.matched).toBe(true);
    expect(r2.result.log.macroOutputs).toEqual([]);

    const r3 = processMidiMessage({ channel: 0, cc: 10, value: 120 }, rules, {}, state);
    state = r3.nextState;
    // Average of [60, 90, 120] = 90
    expect(r3.result.log.mappedValue).toBe(90);
    expect(r3.result.log.matched).toBe(true);
    expect(r3.result.log.macroOutputs).toEqual([]);
  });

  it('smoothing buffer grows up to window size then drops oldest', () => {
    const rules: CompiledRules = { '10': rule((v) => v, { smoothing: 2 }) };

    let state = INITIAL_ENGINE_STATE;

    // Send value 100
    const r1 = processMidiMessage({ channel: 0, cc: 10, value: 100 }, rules, {}, state);
    state = r1.nextState;
    expect(state.smoothingBuffers['10']).toEqual([100]);
    expect(r1.result.log.matched).toBe(true);
    expect(r1.result.log.macroOutputs).toEqual([]);

    // Send value 50 => buffer [100, 50], average = 75
    const r2 = processMidiMessage({ channel: 0, cc: 10, value: 50 }, rules, {}, state);
    state = r2.nextState;
    expect(state.smoothingBuffers['10']).toEqual([100, 50]);
    expect(r2.result.log.mappedValue).toBe(75);
    expect(r2.result.log.matched).toBe(true);
    expect(r2.result.log.macroOutputs).toEqual([]);

    // Send value 0 => buffer [50, 0] (100 dropped), average = 25
    const r3 = processMidiMessage({ channel: 0, cc: 10, value: 0 }, rules, {}, state);
    state = r3.nextState;
    expect(state.smoothingBuffers['10']).toEqual([50, 0]);
    expect(r3.result.log.mappedValue).toBe(25);
    expect(r3.result.log.matched).toBe(true);
    expect(r3.result.log.macroOutputs).toEqual([]);
  });

  it('no smoothing when smoothing=0', () => {
    const rules: CompiledRules = { '10': rule((v) => v, { smoothing: 0 }) };

    const { result, nextState } = processMidiMessage(
      { channel: 0, cc: 10, value: 64 },
      rules,
      {},
      INITIAL_ENGINE_STATE,
    );

    expect(result.log.mappedValue).toBe(64);
    expect(result.log.matched).toBe(true);
    expect(result.log.macroOutputs).toEqual([]);
    // No smoothing buffer should be created
    expect(nextState.smoothingBuffers['10']).toBeUndefined();
  });

  it('smoothing buffers are per-CC (different CCs have independent buffers)', () => {
    const rules: CompiledRules = {
      '10': rule((v) => v, { smoothing: 2 }),
      '20': rule((v) => v, { smoothing: 2 }),
    };

    let state = INITIAL_ENGINE_STATE;

    // CC 10: value 100
    const r1 = processMidiMessage({ channel: 0, cc: 10, value: 100 }, rules, {}, state);
    state = r1.nextState;

    // CC 20: value 50
    const r2 = processMidiMessage({ channel: 0, cc: 20, value: 50 }, rules, {}, state);
    state = r2.nextState;

    // CC 10 buffer should only have [100], CC 20 buffer should only have [50]
    expect(state.smoothingBuffers['10']).toEqual([100]);
    expect(state.smoothingBuffers['20']).toEqual([50]);

    // CC 10: value 60 => avg([100, 60]) = 80
    const r3 = processMidiMessage({ channel: 0, cc: 10, value: 60 }, rules, {}, state);
    state = r3.nextState;
    expect(r3.result.log.mappedValue).toBe(80);

    // CC 20: value 10 => avg([50, 10]) = 30
    const r4 = processMidiMessage({ channel: 0, cc: 20, value: 10 }, rules, {}, state);
    state = r4.nextState;
    expect(r4.result.log.mappedValue).toBe(30);
  });

  it('smoothing buffer persists across calls via state', () => {
    const rules: CompiledRules = { '10': rule((v) => v, { smoothing: 3 }) };

    let state = INITIAL_ENGINE_STATE;

    const r1 = processMidiMessage({ channel: 0, cc: 10, value: 30 }, rules, {}, state);
    state = r1.nextState;
    expect(state.smoothingBuffers['10']).toEqual([30]);

    const r2 = processMidiMessage({ channel: 0, cc: 10, value: 60 }, rules, {}, state);
    state = r2.nextState;
    expect(state.smoothingBuffers['10']).toEqual([30, 60]);

    // Buffer persists and grows
    const r3 = processMidiMessage({ channel: 0, cc: 10, value: 90 }, rules, {}, state);
    state = r3.nextState;
    expect(state.smoothingBuffers['10']).toEqual([30, 60, 90]);
  });
});

describe('toggle mode', () => {
  const status = (ch: number) => 0xb0 + ch;

  it('toggles ON on first press (value > 0), sends mapped max', () => {
    const rules: CompiledRules = { '10': rule((v) => v, { mode: 'toggle' }) };

    const { result, nextState } = processMidiMessage(
      { channel: 0, cc: 10, value: 127 },
      rules,
      {},
      INITIAL_ENGINE_STATE,
    );

    // Toggle flips from false to true -> transform(127) = 127
    expect(result.log.mappedValue).toBe(127);
    expect(result.log.matched).toBe(true);
    expect(result.log.macroOutputs).toEqual([]);
    expect(nextState.toggleStates['10']).toBe(true);
    const mainMsg = result.outputMessages[result.outputMessages.length - 1];
    expect(mainMsg).toEqual([status(0), 10, 127]);
  });

  it('toggles OFF on second press, sends mapped min', () => {
    const rules: CompiledRules = { '10': rule((v) => v, { mode: 'toggle' }) };
    const state: EngineState = {
      prevCode: null,
      smoothingBuffers: {},
      toggleStates: { '10': true },
    };

    const { result, nextState } = processMidiMessage({ channel: 0, cc: 10, value: 127 }, rules, {}, state);

    // Toggle flips from true to false -> transform(0) = 0
    expect(result.log.mappedValue).toBe(0);
    expect(result.log.matched).toBe(true);
    expect(result.log.macroOutputs).toEqual([]);
    expect(nextState.toggleStates['10']).toBe(false);
    const mainMsg = result.outputMessages[result.outputMessages.length - 1];
    expect(mainMsg).toEqual([status(0), 10, 0]);
  });

  it('ignores release (value = 0), sends current toggle state', () => {
    const rules: CompiledRules = { '10': rule((v) => v, { mode: 'toggle' }) };
    const state: EngineState = {
      prevCode: null,
      smoothingBuffers: {},
      toggleStates: { '10': true },
    };

    const { result, nextState } = processMidiMessage({ channel: 0, cc: 10, value: 0 }, rules, {}, state);

    // Release: don't flip, toggle stays true -> transform(127) = 127
    expect(result.log.mappedValue).toBe(127);
    expect(result.log.matched).toBe(true);
    expect(result.log.macroOutputs).toEqual([]);
    expect(nextState.toggleStates['10']).toBe(true);
  });

  it('toggle state persists across calls via state', () => {
    const rules: CompiledRules = { '10': rule((v) => v, { mode: 'toggle' }) };

    // First press: toggle ON
    const r1 = processMidiMessage({ channel: 0, cc: 10, value: 100 }, rules, {}, INITIAL_ENGINE_STATE);
    expect(r1.nextState.toggleStates['10']).toBe(true);

    // Release: stays ON
    const r2 = processMidiMessage({ channel: 0, cc: 10, value: 0 }, rules, {}, r1.nextState);
    expect(r2.nextState.toggleStates['10']).toBe(true);

    // Second press: toggle OFF
    const r3 = processMidiMessage({ channel: 0, cc: 10, value: 100 }, rules, {}, r2.nextState);
    expect(r3.nextState.toggleStates['10']).toBe(false);
    expect(r3.result.log.mappedValue).toBe(0);
    expect(r3.result.log.matched).toBe(true);
    expect(r3.result.log.macroOutputs).toEqual([]);
  });

  it('toggle state is per-CC', () => {
    const rules: CompiledRules = {
      '10': rule((v) => v, { mode: 'toggle' }),
      '20': rule((v) => v, { mode: 'toggle' }),
    };

    let state = INITIAL_ENGINE_STATE;

    // Press CC 10: toggle ON
    const r1 = processMidiMessage({ channel: 0, cc: 10, value: 127 }, rules, {}, state);
    state = r1.nextState;
    expect(state.toggleStates['10']).toBe(true);
    expect(state.toggleStates['20']).toBeUndefined();

    // Press CC 20: toggle ON
    const r2 = processMidiMessage({ channel: 0, cc: 20, value: 127 }, rules, {}, state);
    state = r2.nextState;
    expect(state.toggleStates['10']).toBe(true);
    expect(state.toggleStates['20']).toBe(true);

    // Press CC 10 again: toggle OFF
    const r3 = processMidiMessage({ channel: 0, cc: 10, value: 127 }, rules, {}, state);
    state = r3.nextState;
    expect(state.toggleStates['10']).toBe(false);
    expect(state.toggleStates['20']).toBe(true); // CC 20 unchanged
  });

  it('toggle works with rule transform applied', () => {
    // Transform halves the value: 127 -> 64, 0 -> 0
    const rules: CompiledRules = { '10': rule((v) => v / 2, { mode: 'toggle' }) };

    // Press: toggle ON -> transform(127) = 63.5 -> clamped to 64
    const r1 = processMidiMessage({ channel: 0, cc: 10, value: 127 }, rules, {}, INITIAL_ENGINE_STATE);
    expect(r1.result.log.mappedValue).toBe(64);
    expect(r1.result.log.matched).toBe(true);
    expect(r1.result.log.macroOutputs).toEqual([]);

    // Press again: toggle OFF -> transform(0) = 0
    const r2 = processMidiMessage({ channel: 0, cc: 10, value: 127 }, rules, {}, r1.nextState);
    expect(r2.result.log.mappedValue).toBe(0);
    expect(r2.result.log.matched).toBe(true);
    expect(r2.result.log.macroOutputs).toEqual([]);
  });
});

describe('macros', () => {
  const status = (ch: number) => 0xb0 + ch;

  it('macro generates additional output messages for each macro output', () => {
    const rules: CompiledRules = { '10': rule((v) => v) };
    const macros: CompiledMacros = {
      '10': [{ outputCc: 20, transform: (v) => v }],
    };

    const { result } = processMidiMessage({ channel: 0, cc: 10, value: 64 }, rules, macros, INITIAL_ENGINE_STATE);

    // NRPN preamble (2) + main (1) + macro (1) = 4 messages
    expect(result.outputMessages.length).toBe(4);
    // Macro output is after main message
    expect(result.outputMessages[3]).toEqual([status(0), 20, 64]);
    expect(result.log.matched).toBe(true);
    expect(result.log.macroOutputs).toEqual([{ cc: 20, value: 64 }]);
  });

  it('macro transform is applied to input value', () => {
    const rules: CompiledRules = { '10': rule((v) => v) };
    const macros: CompiledMacros = {
      '10': [{ outputCc: 30, transform: (v) => v * 2 }],
    };

    const { result } = processMidiMessage({ channel: 0, cc: 10, value: 50 }, rules, macros, INITIAL_ENGINE_STATE);

    // macro: transform(50) = 100
    const macroMsg = result.outputMessages[result.outputMessages.length - 1];
    expect(macroMsg).toEqual([status(0), 30, 100]);
    expect(result.log.matched).toBe(true);
    expect(result.log.macroOutputs).toEqual([{ cc: 30, value: 100 }]);
  });

  it('macro output values are clamped to 0-127', () => {
    const rules: CompiledRules = { '10': rule((v) => v) };
    const macros: CompiledMacros = {
      '10': [
        { outputCc: 30, transform: (v) => v * 10 }, // will exceed 127
        { outputCc: 40, transform: (_v) => -50 }, // will go below 0
      ],
    };

    const { result } = processMidiMessage({ channel: 0, cc: 10, value: 100 }, rules, macros, INITIAL_ENGINE_STATE);

    // Macro outputs clamped
    const msgs = result.outputMessages;
    expect(msgs[msgs.length - 2]).toEqual([status(0), 30, 127]); // clamped above
    expect(msgs[msgs.length - 1]).toEqual([status(0), 40, 0]); // clamped below
    expect(result.log.matched).toBe(true);
    expect(result.log.macroOutputs).toEqual([
      { cc: 30, value: 127 },
      { cc: 40, value: 0 },
    ]);
  });

  it('multiple macro outputs produce multiple messages', () => {
    const rules: CompiledRules = { '10': rule((v) => v) };
    const macros: CompiledMacros = {
      '10': [
        { outputCc: 20, transform: (v) => v },
        { outputCc: 30, transform: (v) => v + 10 },
        { outputCc: 40, transform: (v) => v - 10 },
      ],
    };

    const { result } = processMidiMessage({ channel: 0, cc: 10, value: 50 }, rules, macros, INITIAL_ENGINE_STATE);

    // NRPN preamble (2) + main (1) + 3 macros = 6
    expect(result.outputMessages.length).toBe(6);
    expect(result.outputMessages[3]).toEqual([status(0), 20, 50]);
    expect(result.outputMessages[4]).toEqual([status(0), 30, 60]);
    expect(result.outputMessages[5]).toEqual([status(0), 40, 40]);
    expect(result.log.matched).toBe(true);
    expect(result.log.macroOutputs).toEqual([
      { cc: 20, value: 50 },
      { cc: 30, value: 60 },
      { cc: 40, value: 40 },
    ]);
  });

  it('macros work alongside regular rules (both produce output)', () => {
    const rules: CompiledRules = { '10': rule((v) => v * 2) }; // doubles
    const macros: CompiledMacros = {
      '10': [{ outputCc: 20, transform: (v) => v + 5 }],
    };

    const { result } = processMidiMessage({ channel: 0, cc: 10, value: 50 }, rules, macros, INITIAL_ENGINE_STATE);

    // Main rule: 50 * 2 = 100
    expect(result.outputMessages[2]).toEqual([status(0), 10, 100]);
    // Macro: 50 + 5 = 55 (uses original msg.value, not mapped)
    expect(result.outputMessages[3]).toEqual([status(0), 20, 55]);
    expect(result.log.matched).toBe(true);
    expect(result.log.macroOutputs).toEqual([{ cc: 20, value: 55 }]);
  });

  it('macros work without a matching rule', () => {
    const rules: CompiledRules = {}; // no rule for cc 10
    const macros: CompiledMacros = {
      '10': [{ outputCc: 20, transform: (v) => v }],
    };

    const { result } = processMidiMessage({ channel: 0, cc: 10, value: 64 }, rules, macros, INITIAL_ENGINE_STATE);

    // NRPN (2) + main unmapped (1) + macro (1) = 4
    expect(result.outputMessages.length).toBe(4);
    // Main message: unmapped, value stays 64
    expect(result.outputMessages[2]).toEqual([status(0), 10, 64]);
    // Macro output
    expect(result.outputMessages[3]).toEqual([status(0), 20, 64]);
    expect(result.log.matched).toBe(false);
    expect(result.log.macroOutputs).toEqual([{ cc: 20, value: 64 }]);
  });

  it('no macro messages when cc has no macro defined', () => {
    const rules: CompiledRules = { '10': rule((v) => v) };
    const macros: CompiledMacros = {}; // no macros

    const { result } = processMidiMessage({ channel: 0, cc: 10, value: 64 }, rules, macros, INITIAL_ENGINE_STATE);

    // NRPN preamble (2) + main (1) = 3 (no macro messages)
    expect(result.outputMessages.length).toBe(3);
    expect(result.log.matched).toBe(true);
    expect(result.log.macroOutputs).toEqual([]);
  });
});
