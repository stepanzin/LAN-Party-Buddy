import { describe, expect, it } from 'bun:test';
import {
  decodeMessage,
  decodePinChallenge,
  encodeCC,
  encodePinChallenge,
  extractFrames,
} from '@domain/network-protocol';
import fc from 'fast-check';

const validChannel = fc.integer({ min: 0, max: 15 });
const validCC = fc.integer({ min: 0, max: 127 });
const validValue = fc.integer({ min: 0, max: 127 });

describe('PBT: Network Protocol', () => {
  it('encodeCC then decodeMessage roundtrips for any valid channel, cc, value', () => {
    fc.assert(
      fc.property(validChannel, validCC, validValue, (channel, cc, value) => {
        const encoded = encodeCC(channel, cc, value);
        const decoded = decodeMessage(encoded);
        expect(decoded).toEqual({ type: 'cc', channel, cc, value });
      }),
    );
  });

  it('decodeMessage never throws for any random 4 bytes', () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 4, maxLength: 4 }), (data) => {
        const result = decodeMessage(data);
        // result is either a valid NetworkMessage or null — no throws
        expect(result === null || typeof result === 'object').toBe(true);
      }),
    );
  });

  it('extractFrames: frames.length * 4 + remaining.length === input.length', () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 0, maxLength: 100 }), (buffer) => {
        const { frames, remaining } = extractFrames(buffer);
        expect(frames.length * 4 + remaining.length).toBe(buffer.length);
      }),
    );
  });

  it('PIN roundtrip: any 4-char ASCII string encodes then decodes to same string', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 4, maxLength: 4, unit: 'grapheme-ascii' }), (pin) => {
        const encoded = encodePinChallenge(pin);
        const decoded = decodePinChallenge(encoded);
        expect(decoded).toBe(pin);
      }),
    );
  });
});
