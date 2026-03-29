import { select } from '@inquirer/prompts';
import type { UserInterfacePort } from '../ports/user-interface.port';
import type { MidiDevice } from '../ports/device-discovery.port';

export class InquirerCliAdapter implements UserInterfacePort {
  async selectDevice(devices: MidiDevice[]): Promise<number> {
    return select({
      message: 'Select MIDI input device:',
      choices: devices.map(d => ({ value: d.index, name: d.name })),
    });
  }

  showInfo(message: string): void {
    console.log(message);
  }

  showWarning(message: string): void {
    console.warn(message);
  }

  showError(message: string): void {
    console.error(message);
  }

  logMapping(cc: number, originalValue: number, mappedValue: number): void {
    console.log(`CC: ${cc} Value: ${originalValue} -> ${mappedValue}`);
  }
}
