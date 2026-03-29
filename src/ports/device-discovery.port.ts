export type MidiDevice = {
  readonly index: number;
  readonly name: string;
};

export interface DeviceDiscoveryPort {
  listDevices(): MidiDevice[];
  isDeviceConnected(deviceName: string): boolean;
}
