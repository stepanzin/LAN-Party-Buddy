// Message types
export const MSG_CC = 0x01;
export const MSG_HEARTBEAT = 0x02;
export const MSG_DISCONNECT = 0xFF;

export type NetworkMessage =
  | { type: 'cc'; channel: number; cc: number; value: number }
  | { type: 'heartbeat' }
  | { type: 'disconnect' };

// Encode
export function encodeCC(channel: number, cc: number, value: number): Uint8Array {
  return new Uint8Array([MSG_CC, channel, cc, value]);
}

export function encodeHeartbeat(): Uint8Array {
  return new Uint8Array([MSG_HEARTBEAT, 0, 0, 0]);
}

export function encodeDisconnect(): Uint8Array {
  return new Uint8Array([MSG_DISCONNECT, 0, 0, 0]);
}

// Decode — returns null for invalid data
export function decodeMessage(data: Uint8Array): NetworkMessage | null {
  if (data.length < 4) return null;
  const type = data[0];
  if (type === MSG_CC) {
    const channel = data[1]!;
    const cc = data[2]!;
    const value = data[3]!;
    if (channel > 15 || cc > 127 || value > 127) return null;
    return { type: 'cc', channel, cc, value };
  }
  if (type === MSG_HEARTBEAT) return { type: 'heartbeat' };
  if (type === MSG_DISCONNECT) return { type: 'disconnect' };
  return null;
}

// PIN
export function encodePinChallenge(pin: string): Uint8Array {
  return new TextEncoder().encode(pin.slice(0, 4).padEnd(4, '0'));
}

export function decodePinChallenge(data: Uint8Array): string {
  return new TextDecoder().decode(data.slice(0, 4));
}

export function encodePinResponse(accepted: boolean): Uint8Array {
  return new Uint8Array([accepted ? 0x01 : 0x00]);
}

export function decodePinResponse(data: Uint8Array): boolean {
  return data[0] === 0x01;
}

// Frame extraction from TCP stream buffer
export function extractFrames(buffer: Uint8Array): { frames: Uint8Array[]; remaining: Uint8Array } {
  const frames: Uint8Array[] = [];
  let offset = 0;
  while (offset + 4 <= buffer.length) {
    frames.push(buffer.slice(offset, offset + 4));
    offset += 4;
  }
  return { frames, remaining: buffer.slice(offset) };
}
