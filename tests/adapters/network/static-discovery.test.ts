import { describe, it, expect } from 'bun:test';
import { StaticDeviceDiscoveryAdapter } from '../../../src/adapters/network/static-device-discovery.adapter';

describe('StaticDeviceDiscoveryAdapter', () => {
  it('listDevices returns single device', () => {
    const adapter = new StaticDeviceDiscoveryAdapter();
    const devices = adapter.listDevices();
    expect(devices).toHaveLength(1);
    expect(devices[0]!.index).toBe(0);
  });

  it('uses custom device name', () => {
    const adapter = new StaticDeviceDiscoveryAdapter('My Host');
    expect(adapter.listDevices()[0]!.name).toBe('My Host');
  });

  it('isDeviceConnected always returns true', () => {
    const adapter = new StaticDeviceDiscoveryAdapter();
    expect(adapter.isDeviceConnected('anything')).toBe(true);
    expect(adapter.isDeviceConnected('')).toBe(true);
  });
});
