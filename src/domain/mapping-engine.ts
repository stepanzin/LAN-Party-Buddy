import type { MidiCC } from './midi-message.ts';
import type { CompiledRules, CompiledMacros } from './mapping-rule.ts';

export type EngineState = {
  readonly prevCode: number | null;
  readonly smoothingBuffers: Record<string, number[]>;   // cc → last N values
  readonly toggleStates: Record<string, boolean>;        // cc → on/off
};

export const INITIAL_ENGINE_STATE: EngineState = {
  prevCode: null,
  smoothingBuffers: {},
  toggleStates: {},
};

export type MappingResult = {
  readonly outputMessages: ReadonlyArray<readonly [number, number, number]>;
  readonly log: {
    readonly cc: number;
    readonly originalValue: number;
    readonly mappedValue: number;
  };
};

const clampMidi = (v: number): number => {
  if (Number.isNaN(v)) return 0;
  return Math.max(0, Math.min(127, Math.round(v)));
};

export function processMidiMessage(
  msg: MidiCC,
  rules: CompiledRules,
  macros: CompiledMacros,
  state: EngineState,
): { result: MappingResult; nextState: EngineState } {
  const { channel, cc, value } = msg;
  const ccKey = cc.toString();
  const statusByte = 0xb0 + channel;

  const outputMessages: Array<readonly [number, number, number]> = [];

  // NRPN preamble: CC 49 special case
  if (cc === 49) {
    outputMessages.push([statusByte, 99, 0]);
    outputMessages.push([statusByte, 100, 127]);
  } else {
    outputMessages.push([statusByte, 99, 127]);
    outputMessages.push([statusByte, 100, 0]);
  }

  // Look up rule
  const rule = rules[ccKey];

  let mappedValue = value;
  let nextState: EngineState = { ...state };
  const newSmoothingBuffers = { ...state.smoothingBuffers };
  const newToggleStates = { ...state.toggleStates };

  if (rule !== undefined) {

    // Smoothing logic (applied before curve mapping)
    let inputValue = value;
    if (rule.smoothing > 0) {
      const buffer = [...(state.smoothingBuffers[ccKey] ?? [])];
      buffer.push(value);
      if (buffer.length > rule.smoothing) {
        buffer.shift();
      }
      newSmoothingBuffers[ccKey] = buffer;
      inputValue = Math.round(buffer.reduce((sum, v) => sum + v, 0) / buffer.length);
    }

    // Toggle logic
    if (rule.mode === 'toggle') {
      let toggleState = state.toggleStates[ccKey] ?? false;
      if (value > 0) {
        // Button press: flip toggle
        toggleState = !toggleState;
      }
      // value === 0 (release): don't flip, use current toggle state
      newToggleStates[ccKey] = toggleState;
      mappedValue = clampMidi(rule.transform(toggleState ? 127 : 0));
    } else {
      // Normal mode
      mappedValue = clampMidi(rule.transform(inputValue));
    }

    nextState = {
      ...state,
      smoothingBuffers: newSmoothingBuffers,
      toggleStates: newToggleStates,
    };
  } else {
    if (state.prevCode !== null) {
      outputMessages.push([statusByte, state.prevCode, 0]);
    }
    nextState = {
      ...state,
      prevCode: cc,
      smoothingBuffers: newSmoothingBuffers,
      toggleStates: newToggleStates,
    };
  }

  // Main output message
  outputMessages.push([statusByte, cc, mappedValue]);

  // Macro logic: additional outputs
  const macroList = macros[ccKey];
  if (macroList) {
    for (const macro of macroList) {
      outputMessages.push([statusByte, macro.outputCc, clampMidi(macro.transform(value))]);
    }
  }

  return {
    result: {
      outputMessages,
      log: {
        cc,
        originalValue: value,
        mappedValue,
      },
    },
    nextState,
  };
}
