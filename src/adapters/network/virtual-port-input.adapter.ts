import midi from '@julusian/midi';
import type { MidiInputPort, MidiMessageHandler, MidiErrorHandler } from '@ports/midi-input.port';
import { parseMidiCC } from '@domain/midi-message';
import { findExistingPortByName } from '@adapters/julusian-midi.adapter';

export class VirtualPortInputAdapter implements MidiInputPort {
  private input = new midi.Input();
  private portName: string;

  constructor(portName: string) {
    this.portName = portName;
  }

  onMessage(handler: MidiMessageHandler): void {
    this.input.on('message', (_: number, message: readonly number[]) => {
      const parsed = parseMidiCC(message);
      if (parsed) handler(parsed);
    });
  }

  onError(handler: MidiErrorHandler): void {
    (this.input as NodeJS.EventEmitter).on('error', handler);
  }

  open(_deviceIndex: number): void {
    // Warn if a port with the same name already exists (e.g. another app instance)
    if (findExistingPortByName(this.portName)) {
      console.warn(`Warning: A MIDI input port named "${this.portName}" already exists. DAW may see duplicate ports.`);
    }
    // For virtual port mode, we ignore deviceIndex and open a virtual port
    this.input.openVirtualPort(this.portName);
  }

  close(): void {
    try { this.input.closePort(); } catch {}
  }
}
