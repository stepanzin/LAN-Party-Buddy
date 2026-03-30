import type { AppMode } from '@domain/config';
import type { MidiDevice } from './device-discovery.port';

export interface UserInterfacePort {
  // Lifecycle
  start(): void;
  stop(): void;
  waitForExit(): Promise<void>;

  // First-run
  showWelcome(): Promise<AppMode>;

  // Device selection
  selectDevice(devices: MidiDevice[]): Promise<number>;

  // Messages
  showInfo(message: string): void;
  showWarning(message: string): void;
  showError(message: string): void;
  logMapping(cc: number, originalValue: number, mappedValue: number): void;
}
