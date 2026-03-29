import { describe, it, expect } from 'bun:test';
import fc from 'fast-check';
import { parseMidiCC, isValidMidiCC, toRawMessage } from '../../src/domain/midi-message';

const validChannel = fc.integer({ min: 0, max: 15 });
const validCC = fc.integer({ min: 0, max: 127 });
const validValue = fc.integer({ min: 0, max: 127 });

describe('PBT: MIDI Message', () => {
  it('parseMidiCC roundtrips with valid CC status bytes', () => {
    fc.assert(fc.property(
      validChannel, validCC, validValue,
      (channel, cc, value) => {
        const status = 0xB0 + channel;
        const parsed = parseMidiCC([status, cc, value]);
        expect(parsed).not.toBeNull();
        expect(parsed!.channel).toBe(channel);
        expect(parsed!.cc).toBe(cc);
        expect(parsed!.value).toBe(value);
      }
    ));
  });

  it('isValidMidiCC is consistent with parseMidiCC', () => {
    fc.assert(fc.property(
      fc.array(fc.integer({ min: -10, max: 300 }), { minLength: 0, maxLength: 5 }),
      (msg) => {
        const valid = isValidMidiCC(msg);
        const parsed = parseMidiCC(msg);
        expect(valid).toBe(parsed !== null);
      }
    ));
  });

  it('rejects all non-CC status bytes', () => {
    fc.assert(fc.property(
      fc.integer({ min: 0, max: 255 }).filter(s => s < 0xB0 || s > 0xBF),
      validCC, validValue,
      (status, cc, value) => {
        expect(parseMidiCC([status, cc, value])).toBeNull();
      }
    ));
  });

  it('rejects messages with wrong length', () => {
    fc.assert(fc.property(
      fc.array(fc.integer({ min: 0, max: 255 }), { minLength: 0, maxLength: 10 })
        .filter(arr => arr.length !== 3),
      (msg) => {
        expect(parseMidiCC(msg)).toBeNull();
      }
    ));
  });
});
