import midi from '@julusian/midi';
import type { MidiInputPort, MidiMessageHandler, MidiErrorHandler } from '@ports/midi-input.port';
import type { MidiOutputPort } from '@ports/midi-output.port';
import type { DeviceDiscoveryPort, MidiDevice } from '@ports/device-discovery.port';
import { parseMidiCC } from '@domain/midi-message';

/**
 * Check whether a MIDI port with the given name already exists on the system.
 * Probes both input and output port lists. Useful for detecting duplicate
 * virtual port names when multiple app instances run on the same machine.
 */
export function findExistingPortByName(name: string): boolean {
  const output = new midi.Output();
  for (let i = 0; i < output.getPortCount(); i++) {
    if (output.getPortName(i) === name) {
      output.closePort();
      return true;
    }
  }
  output.closePort();

  const input = new midi.Input();
  for (let i = 0; i < input.getPortCount(); i++) {
    if (input.getPortName(i) === name) {
      input.closePort();
      return true;
    }
  }
  input.closePort();

  return false;
}

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
    // Warn if a port with the same name already exists (e.g. another app instance)
    const probe = new midi.Output();
    for (let i = 0; i < probe.getPortCount(); i++) {
      if (probe.getPortName(i) === name) {
        console.warn(`Warning: A MIDI port named "${name}" already exists. DAW may see duplicate ports.`);
        break;
      }
    }
    probe.closePort();
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
