import midi from '@julusian/midi';
import type { MidiInputPort, MidiMessageHandler, MidiErrorHandler } from '../ports/midi-input.port';
import type { MidiOutputPort } from '../ports/midi-output.port';
import type { DeviceDiscoveryPort, MidiDevice } from '../ports/device-discovery.port';
import { parseMidiCC } from '../domain/midi-message';

export class JulusianMidiInputAdapter implements MidiInputPort {
  private input = new midi.Input();

  onMessage(handler: MidiMessageHandler): void {
    this.input.on('message', (_: number, message: readonly number[]) => {
      const parsed = parseMidiCC(message);
      if (parsed) handler(parsed);
    });
  }

  onError(handler: MidiErrorHandler): void {
    (this.input as NodeJS.EventEmitter).on('error', handler);
  }

  open(deviceIndex: number): void {
    this.input.openPort(deviceIndex);
  }

  close(): void {
    try {
      this.input.closePort();
    } catch {}
  }
}

export class JulusianMidiOutputAdapter implements MidiOutputPort {
  private output = new midi.Output();

  openVirtual(name: string): void {
    this.output.openVirtualPort(name);
  }

  send(message: readonly [number, number, number]): void {
    this.output.send([...message]);
  }

  close(): void {
    try {
      this.output.closePort();
    } catch {}
  }
}

export class JulusianDeviceDiscoveryAdapter implements DeviceDiscoveryPort {
  listDevices(): MidiDevice[] {
    const probe = new midi.Input();
    const devices = Array.from({ length: probe.getPortCount() }).map((_, i) => ({
      index: i,
      name: probe.getPortName(i),
    }));
    probe.closePort();
    return devices;
  }

  isDeviceConnected(deviceName: string): boolean {
    return this.listDevices().some(d => d.name === deviceName);
  }
}
