import type { MidiDevice } from './device-discovery.port';

export interface UserInterfacePort {
  selectDevice(devices: MidiDevice[]): Promise<number>;
  showInfo(message: string): void;
  showWarning(message: string): void;
  showError(message: string): void;
  logMapping(cc: number, originalValue: number, mappedValue: number): void;
}
