/** Parsed MIDI Control Change message. */
export type MidiCC = {
  readonly channel: number;
  readonly cc: number;
  readonly value: number;
};

const CC_STATUS_MIN = 0xb0; // 176
const CC_STATUS_MAX = 0xbf; // 191
const DATA_MIN = 0;
const DATA_MAX = 127;

const isInt = (n: number): boolean => Number.isInteger(n);

const inRange = (n: number, min: number, max: number): boolean => isInt(n) && n >= min && n <= max;

/**
 * Parse a raw MIDI message into a `MidiCC` structure.
 * Returns `null` when the message is not a valid 3-byte CC message.
 */
export function parseMidiCC(message: readonly number[]): MidiCC | null {
  if (message.length !== 3) return null;

  const [status, cc, value] = message;

  if (status === undefined || cc === undefined || value === undefined) return null;

  if (!inRange(status, CC_STATUS_MIN, CC_STATUS_MAX)) return null;
  if (!inRange(cc, DATA_MIN, DATA_MAX)) return null;
  if (!inRange(value, DATA_MIN, DATA_MAX)) return null;

  return {
    channel: status - CC_STATUS_MIN,
    cc,
    value,
  };
}

/** Check whether a raw MIDI message is a valid CC message. */
export function isValidMidiCC(message: readonly number[]): boolean {
  return parseMidiCC(message) !== null;
}

export function toRawMessage(status: number, cc: number, value: number): readonly [number, number, number] {
  return [status, cc, value] as const;
}
