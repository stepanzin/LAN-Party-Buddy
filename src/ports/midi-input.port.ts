import type { MidiCC } from '../domain/midi-message';

export type MidiMessageHandler = (msg: MidiCC) => void;
export type MidiErrorHandler = (error: Error) => void;

export interface MidiInputPort {
  onMessage(handler: MidiMessageHandler): void;
  onError(handler: MidiErrorHandler): void;
  open(deviceIndex: number): void;
  close(): void;
}
