import { describe, it, expect } from 'bun:test';
import fc from 'fast-check';
import { processMidiMessage, INITIAL_ENGINE_STATE, type EngineState } from '@domain/mapping-engine';
import type { CompiledRules, CompiledMacros, CompiledRule } from '@domain/mapping-rule';
import type { MidiCC } from '@domain/midi-message';

const validMidiCC = fc.record({
  channel: fc.integer({ min: 0, max: 15 }),
  cc: fc.integer({ min: 0, max: 127 }),
  value: fc.integer({ min: 0, max: 127 }),
});

describe('PBT: Mapping Engine', () => {
  it('all output message values are in 0-127 range', () => {
    fc.assert(fc.property(
      validMidiCC,
      (msg) => {
        const rules: CompiledRules = {
          [msg.cc.toString()]: { transform: (v) => v * 3 - 50, smoothing: 0, mode: 'normal' as const },
        };
        const { result } = processMidiMessage(msg, rules, {}, INITIAL_ENGINE_STATE);
        for (const [status, cc, value] of result.outputMessages) {
          expect(status).toBeGreaterThanOrEqual(0);
          expect(status).toBeLessThanOrEqual(255);
          expect(cc).toBeGreaterThanOrEqual(0);
          expect(cc).toBeLessThanOrEqual(127);
          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThanOrEqual(127);
        }
      }
    ));
  });

  it('always produces at least 3 output messages (NRPN preamble + main)', () => {
    fc.assert(fc.property(
      validMidiCC,
      (msg) => {
        const { result } = processMidiMessage(msg, {}, {}, INITIAL_ENGINE_STATE);
        expect(result.outputMessages.length).toBeGreaterThanOrEqual(3);
      }
    ));
  });

  it('status byte in output matches 0xB0 + channel', () => {
    fc.assert(fc.property(
      validMidiCC,
      (msg) => {
        const { result } = processMidiMessage(msg, {}, {}, INITIAL_ENGINE_STATE);
        const expectedStatus = 0xB0 + msg.channel;
        for (const [status] of result.outputMessages) {
          expect(status).toBe(expectedStatus);
        }
      }
    ));
  });

  it('log always reflects original value', () => {
    fc.assert(fc.property(
      validMidiCC,
      (msg) => {
        const rules: CompiledRules = {
          [msg.cc.toString()]: { transform: (v) => 127 - v, smoothing: 0, mode: 'normal' as const },
        };
        const { result } = processMidiMessage(msg, rules, {}, INITIAL_ENGINE_STATE);
        expect(result.log.originalValue).toBe(msg.value);
        expect(result.log.cc).toBe(msg.cc);
      }
    ));
  });

  it('toggle mode only produces transform(0) or transform(127)', () => {
    fc.assert(fc.property(
      validMidiCC,
      fc.boolean(),
      (msg, prevToggle) => {
        const transform = (v: number) => v;
        const rules: CompiledRules = {
          [msg.cc.toString()]: { transform, smoothing: 0, mode: 'toggle' as const },
        };
        const state: EngineState = {
          ...INITIAL_ENGINE_STATE,
          toggleStates: { [msg.cc.toString()]: prevToggle },
        };
        const { result } = processMidiMessage(msg, rules, {}, state);
        const mainValue = result.outputMessages[result.outputMessages.length - 1]![2];
        // After clamping, toggle output is either transform(0)=0 or transform(127)=127
        expect([0, 127]).toContain(mainValue);
      }
    ));
  });

  it('smoothing output is between min and max of buffer values', () => {
    // Send multiple values, verify smoothed result is within range of sent values
    fc.assert(fc.property(
      fc.integer({ min: 0, max: 15 }),  // channel
      fc.integer({ min: 0, max: 127 }),  // cc
      fc.array(fc.integer({ min: 0, max: 127 }), { minLength: 1, maxLength: 10 }),  // values
      (channel, cc, values) => {
        const rules: CompiledRules = {
          [cc.toString()]: { transform: (v) => v, smoothing: 3, mode: 'normal' as const },
        };
        let state: EngineState = INITIAL_ENGINE_STATE;
        let lastMapped = 0;
        for (const value of values) {
          const { result, nextState } = processMidiMessage(
            { channel, cc, value }, rules, {}, state
          );
          state = nextState;
          lastMapped = result.log.mappedValue;
        }
        // Smoothed value should be within the range of the last 3 values (or fewer)
        const window = values.slice(-3);
        const minVal = Math.min(...window);
        const maxVal = Math.max(...window);
        expect(lastMapped).toBeGreaterThanOrEqual(minVal - 1); // -1 for rounding
        expect(lastMapped).toBeLessThanOrEqual(maxVal + 1);    // +1 for rounding
      }
    ));
  });

  it('macro output count equals number of macro outputs defined', () => {
    fc.assert(fc.property(
      validMidiCC,
      fc.integer({ min: 1, max: 5 }),
      (msg, numOutputs) => {
        const macros: CompiledMacros = {
          [msg.cc.toString()]: Array.from({ length: numOutputs }, (_, i) => ({
            outputCc: (msg.cc + i + 1) % 128,
            transform: (v: number) => v,
          })),
        };
        const { result } = processMidiMessage(msg, {}, macros, INITIAL_ENGINE_STATE);
        // With INITIAL_ENGINE_STATE (prevCode=null) and no rules:
        // 2 NRPN preamble + 1 main + numOutputs macros = 3 + numOutputs
        expect(result.outputMessages.length).toBe(3 + numOutputs);
      }
    ));
  });
});
