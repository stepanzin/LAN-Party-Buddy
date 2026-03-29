export interface MidiOutputPort {
  openVirtual(name: string): void;
  send(message: readonly [number, number, number]): void;
  close(): void;
}
