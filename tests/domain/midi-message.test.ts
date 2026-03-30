import { describe, expect, it } from 'bun:test';

import type { MidiCC } from '@domain/midi-message';
import { parseMidiCC, isValidMidiCC, toRawMessage } from '@domain/midi-message';

describe('parseMidiCC', () => {
  describe('valid MIDI CC messages', () => {
    it('parses a CC message on channel 0 (status 0xB0)', () => {
      const result = parseMidiCC([0xB0, 1, 64]);
      expect(result).toEqual({ channel: 0, cc: 1, value: 64 });
    });

    it('parses a CC message on channel 15 (status 0xBF)', () => {
      const result = parseMidiCC([0xBF, 127, 127]);
      expect(result).toEqual({ channel: 15, cc: 127, value: 127 });
    });

    it('parses minimum valid values (channel 0, cc 0, value 0)', () => {
      const result = parseMidiCC([0xB0, 0, 0]);
      expect(result).toEqual({ channel: 0, cc: 0, value: 0 });
    });

    it('parses maximum valid values (channel 15, cc 127, value 127)', () => {
      const result = parseMidiCC([0xBF, 127, 127]);
      expect(result).toEqual({ channel: 15, cc: 127, value: 127 });
    });

    it('parses a mid-range channel (channel 9, status 0xB9)', () => {
      const result = parseMidiCC([0xB9, 74, 100]);
      expect(result).toEqual({ channel: 9, cc: 74, value: 100 });
    });

    it('accepts readonly arrays', () => {
      const message: readonly number[] = [0xB0, 10, 50];
      const result = parseMidiCC(message);
      expect(result).toEqual({ channel: 0, cc: 10, value: 50 });
    });
  });

  describe('all 16 channels', () => {
    for (let ch = 0; ch < 16; ch++) {
      it(`parses channel ${ch} (status ${0xB0 + ch})`, () => {
        const result = parseMidiCC([0xB0 + ch, 64, 64]);
        expect(result).toEqual({ channel: ch, cc: 64, value: 64 });
      });
    }
  });

  describe('invalid messages — wrong length', () => {
    it('returns null for empty array', () => {
      expect(parseMidiCC([])).toBeNull();
    });

    it('returns null for single element', () => {
      expect(parseMidiCC([0xB0])).toBeNull();
    });

    it('returns null for two elements', () => {
      expect(parseMidiCC([0xB0, 64])).toBeNull();
    });

    it('returns null for four elements', () => {
      expect(parseMidiCC([0xB0, 64, 100, 0])).toBeNull();
    });
  });

  describe('invalid messages — out of range values', () => {
    it('returns null when status byte is below CC range (< 0xB0)', () => {
      expect(parseMidiCC([0xAF, 64, 100])).toBeNull();
    });

    it('returns null when status byte is above CC range (> 0xBF)', () => {
      expect(parseMidiCC([0xC0, 64, 100])).toBeNull();
    });

    it('returns null for negative status byte', () => {
      expect(parseMidiCC([-1, 64, 100])).toBeNull();
    });

    it('returns null for negative cc', () => {
      expect(parseMidiCC([0xB0, -1, 100])).toBeNull();
    });

    it('returns null for negative value', () => {
      expect(parseMidiCC([0xB0, 64, -1])).toBeNull();
    });

    it('returns null when cc > 127', () => {
      expect(parseMidiCC([0xB0, 128, 100])).toBeNull();
    });

    it('returns null when value > 127', () => {
      expect(parseMidiCC([0xB0, 64, 128])).toBeNull();
    });

    it('returns null when status byte > 255', () => {
      expect(parseMidiCC([256, 64, 100])).toBeNull();
    });

    it('returns null when value > 255', () => {
      expect(parseMidiCC([0xB0, 64, 300])).toBeNull();
    });
  });

  describe('invalid messages — non-integer values', () => {
    it('returns null for fractional status byte', () => {
      expect(parseMidiCC([176.5, 64, 100])).toBeNull();
    });

    it('returns null for fractional cc', () => {
      expect(parseMidiCC([0xB0, 1.5, 100])).toBeNull();
    });

    it('returns null for fractional value', () => {
      expect(parseMidiCC([0xB0, 64, 99.9])).toBeNull();
    });

    it('returns null for NaN in message', () => {
      expect(parseMidiCC([NaN, 64, 100])).toBeNull();
    });

    it('returns null for Infinity in message', () => {
      expect(parseMidiCC([0xB0, Infinity, 100])).toBeNull();
    });
  });

  describe('return type shape', () => {
    it('returns an object with channel, cc, and value fields', () => {
      const result = parseMidiCC([0xB3, 7, 100]);
      expect(result).not.toBeNull();
      expect(result).toHaveProperty('channel');
      expect(result).toHaveProperty('cc');
      expect(result).toHaveProperty('value');
    });

    it('channel, cc, and value are all numbers', () => {
      const result = parseMidiCC([0xB0, 10, 50]) as MidiCC;
      expect(typeof result.channel).toBe('number');
      expect(typeof result.cc).toBe('number');
      expect(typeof result.value).toBe('number');
    });
  });
});

describe('isValidMidiCC', () => {
  it('returns true for a valid CC message', () => {
    expect(isValidMidiCC([0xB0, 64, 100])).toBe(true);
  });

  it('returns true for all 16 channels', () => {
    for (let ch = 0; ch < 16; ch++) {
      expect(isValidMidiCC([0xB0 + ch, 0, 0])).toBe(true);
    }
  });

  it('returns false for empty array', () => {
    expect(isValidMidiCC([])).toBe(false);
  });

  it('returns false for non-CC status byte', () => {
    expect(isValidMidiCC([0x90, 64, 100])).toBe(false);
  });

  it('returns false for out of range cc', () => {
    expect(isValidMidiCC([0xB0, 128, 100])).toBe(false);
  });

  it('returns false for out of range value', () => {
    expect(isValidMidiCC([0xB0, 64, 128])).toBe(false);
  });

  it('returns false for non-integer values', () => {
    expect(isValidMidiCC([0xB0, 64, 1.5])).toBe(false);
  });

  it('returns false for wrong length', () => {
    expect(isValidMidiCC([0xB0, 64])).toBe(false);
  });

  it('is consistent with parseMidiCC (valid)', () => {
    const msg: readonly number[] = [0xB5, 100, 50];
    expect(isValidMidiCC(msg)).toBe(true);
    expect(parseMidiCC(msg)).not.toBeNull();
  });

  it('is consistent with parseMidiCC (invalid)', () => {
    const msg: readonly number[] = [0x90, 100, 50];
    expect(isValidMidiCC(msg)).toBe(false);
    expect(parseMidiCC(msg)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// toRawMessage
// ---------------------------------------------------------------------------
describe('toRawMessage', () => {
  it('returns a 3-element tuple of [status, cc, value]', () => {
    const result = toRawMessage(0xB0, 1, 64);
    expect(result).toEqual([0xB0, 1, 64]);
  });

  it('returns correct values for channel 15', () => {
    const result = toRawMessage(0xBF, 127, 127);
    expect(result).toEqual([0xBF, 127, 127]);
  });

  it('returns correct values for minimum values', () => {
    const result = toRawMessage(0xB0, 0, 0);
    expect(result).toEqual([0xB0, 0, 0]);
  });

  it('preserves the exact numeric values passed in', () => {
    const result = toRawMessage(185, 74, 100);
    expect(result[0]).toBe(185);
    expect(result[1]).toBe(74);
    expect(result[2]).toBe(100);
  });

  it('tuple has exactly 3 elements', () => {
    const result = toRawMessage(0xB0, 64, 100);
    expect(result.length).toBe(3);
  });
});
