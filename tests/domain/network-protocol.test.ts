import { describe, expect, it } from 'bun:test';

import {
  MSG_CC,
  MSG_HEARTBEAT,
  MSG_DISCONNECT,
  encodeCC,
  encodeHeartbeat,
  encodeDisconnect,
  decodeMessage,
  encodePinChallenge,
  decodePinChallenge,
  encodePinResponse,
  decodePinResponse,
  extractFrames,
} from '../../src/domain/network-protocol';

// ---------------------------------------------------------------------------
// encodeCC
// ---------------------------------------------------------------------------
describe('encodeCC', () => {
  it('produces [0x01, channel, cc, value]', () => {
    const result = encodeCC(0, 64, 100);
    expect(result).toEqual(new Uint8Array([0x01, 0, 64, 100]));
  });

  it('roundtrips with decodeMessage for valid values', () => {
    const encoded = encodeCC(15, 127, 127);
    const decoded = decodeMessage(encoded);
    expect(decoded).toEqual({ type: 'cc', channel: 15, cc: 127, value: 127 });
  });
});

// ---------------------------------------------------------------------------
// decodeMessage — null cases
// ---------------------------------------------------------------------------
describe('decodeMessage', () => {
  it('returns null for data shorter than 4 bytes', () => {
    expect(decodeMessage(new Uint8Array([0x01, 0, 64]))).toBeNull();
    expect(decodeMessage(new Uint8Array([]))).toBeNull();
    expect(decodeMessage(new Uint8Array([0x01]))).toBeNull();
  });

  it('returns null for unknown type byte', () => {
    expect(decodeMessage(new Uint8Array([0x03, 0, 0, 0]))).toBeNull();
    expect(decodeMessage(new Uint8Array([0x00, 0, 0, 0]))).toBeNull();
    expect(decodeMessage(new Uint8Array([0xFE, 0, 0, 0]))).toBeNull();
  });

  it('returns null for CC with channel > 15', () => {
    expect(decodeMessage(new Uint8Array([0x01, 16, 64, 100]))).toBeNull();
    expect(decodeMessage(new Uint8Array([0x01, 255, 0, 0]))).toBeNull();
  });

  it('returns null for CC with cc > 127', () => {
    expect(decodeMessage(new Uint8Array([0x01, 0, 128, 100]))).toBeNull();
    expect(decodeMessage(new Uint8Array([0x01, 0, 255, 0]))).toBeNull();
  });

  it('returns null for CC with value > 127', () => {
    expect(decodeMessage(new Uint8Array([0x01, 0, 64, 128]))).toBeNull();
    expect(decodeMessage(new Uint8Array([0x01, 0, 0, 255]))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// encodeHeartbeat
// ---------------------------------------------------------------------------
describe('encodeHeartbeat', () => {
  it('produces [0x02, 0, 0, 0]', () => {
    const result = encodeHeartbeat();
    expect(result).toEqual(new Uint8Array([0x02, 0, 0, 0]));
  });

  it('roundtrips with decodeMessage', () => {
    const encoded = encodeHeartbeat();
    const decoded = decodeMessage(encoded);
    expect(decoded).toEqual({ type: 'heartbeat' });
  });
});

// ---------------------------------------------------------------------------
// encodeDisconnect
// ---------------------------------------------------------------------------
describe('encodeDisconnect', () => {
  it('produces [0xFF, 0, 0, 0]', () => {
    const result = encodeDisconnect();
    expect(result).toEqual(new Uint8Array([0xFF, 0, 0, 0]));
  });

  it('roundtrips with decodeMessage', () => {
    const encoded = encodeDisconnect();
    const decoded = decodeMessage(encoded);
    expect(decoded).toEqual({ type: 'disconnect' });
  });
});

// ---------------------------------------------------------------------------
// PIN challenge
// ---------------------------------------------------------------------------
describe('encodePinChallenge', () => {
  it('produces 4 ASCII bytes', () => {
    const result = encodePinChallenge('1234');
    expect(result.length).toBe(4);
    // Check it encodes the right characters
    expect(new TextDecoder().decode(result)).toBe('1234');
  });

  it('roundtrips with decodePinChallenge', () => {
    const pin = 'ABCD';
    const encoded = encodePinChallenge(pin);
    const decoded = decodePinChallenge(encoded);
    expect(decoded).toBe(pin);
  });

  it('pads short PINs with zeros', () => {
    const result = encodePinChallenge('12');
    const decoded = decodePinChallenge(result);
    expect(decoded).toBe('1200');
  });
});

// ---------------------------------------------------------------------------
// PIN response
// ---------------------------------------------------------------------------
describe('encodePinResponse / decodePinResponse', () => {
  it('encodePinResponse(true) produces [0x01], decodePinResponse returns true', () => {
    const encoded = encodePinResponse(true);
    expect(encoded).toEqual(new Uint8Array([0x01]));
    expect(decodePinResponse(encoded)).toBe(true);
  });

  it('encodePinResponse(false) produces [0x00], decodePinResponse returns false', () => {
    const encoded = encodePinResponse(false);
    expect(encoded).toEqual(new Uint8Array([0x00]));
    expect(decodePinResponse(encoded)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// extractFrames
// ---------------------------------------------------------------------------
describe('extractFrames', () => {
  it('extracts complete 4-byte frames from buffer', () => {
    const buffer = new Uint8Array([0x01, 0, 64, 100, 0x02, 0, 0, 0]);
    const { frames, remaining } = extractFrames(buffer);
    expect(frames.length).toBe(2);
    expect(frames[0]).toEqual(new Uint8Array([0x01, 0, 64, 100]));
    expect(frames[1]).toEqual(new Uint8Array([0x02, 0, 0, 0]));
    expect(remaining.length).toBe(0);
  });

  it('returns remaining partial bytes', () => {
    const buffer = new Uint8Array([0x01, 0, 64, 100, 0x02, 0]);
    const { frames, remaining } = extractFrames(buffer);
    expect(frames.length).toBe(1);
    expect(frames[0]).toEqual(new Uint8Array([0x01, 0, 64, 100]));
    expect(remaining).toEqual(new Uint8Array([0x02, 0]));
  });

  it('empty buffer yields no frames and empty remaining', () => {
    const { frames, remaining } = extractFrames(new Uint8Array([]));
    expect(frames.length).toBe(0);
    expect(remaining.length).toBe(0);
  });

  it('7 bytes yields 1 frame + 3 remaining', () => {
    const buffer = new Uint8Array([1, 2, 3, 4, 5, 6, 7]);
    const { frames, remaining } = extractFrames(buffer);
    expect(frames.length).toBe(1);
    expect(frames[0]).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(remaining).toEqual(new Uint8Array([5, 6, 7]));
  });

  it('exact 8 bytes yields 2 frames + 0 remaining', () => {
    const buffer = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const { frames, remaining } = extractFrames(buffer);
    expect(frames.length).toBe(2);
    expect(frames[0]).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(frames[1]).toEqual(new Uint8Array([5, 6, 7, 8]));
    expect(remaining.length).toBe(0);
  });
});
