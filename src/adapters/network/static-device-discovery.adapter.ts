import type { DeviceDiscoveryPort, MidiDevice } from '../../ports/device-discovery.port';

export class StaticDeviceDiscoveryAdapter implements DeviceDiscoveryPort {
  constructor(private deviceName: string = 'Virtual Port (Host Mode)') {}

  listDevices(): MidiDevice[] {
    return [{ index: 0, name: this.deviceName }];
  }

  isDeviceConnected(_deviceName: string): boolean {
    return true; // We ARE the device, always connected
  }
}
