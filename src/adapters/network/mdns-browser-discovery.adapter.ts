import { Bonjour, type RemoteService } from 'bonjour-service';
import type { DeviceDiscoveryPort, MidiDevice } from '../../ports/device-discovery.port';

export class MdnsBrowserDiscoveryAdapter implements DeviceDiscoveryPort {
  private bonjour: Bonjour;
  private browser: ReturnType<Bonjour['find']> | null = null;
  private services: RemoteService[] = [];

  constructor(bonjour?: Bonjour) {
    this.bonjour = bonjour ?? new Bonjour();
  }

  startBrowsing(): void {
    this.browser = this.bonjour.find({ type: 'midi-mapper' });
    this.browser.on('up', (service: RemoteService) => {
      if (!this.services.some(s => s.name === service.name)) {
        this.services.push(service);
      }
    });
    this.browser.on('down', (service: RemoteService) => {
      this.services = this.services.filter(s => s.name !== service.name);
    });
  }

  stopBrowsing(): void {
    this.browser?.stop();
    this.browser = null;
  }

  listDevices(): MidiDevice[] {
    return this.services.map((service, index) => {
      const host = service.addresses?.[0] ?? service.host ?? 'unknown';
      const pinInfo = service.txt?.pin === 'required' ? ' 🔒' : '';
      return {
        index,
        name: `${service.name} (${host}:${service.port})${pinInfo}`,
      };
    });
  }

  isDeviceConnected(deviceName: string): boolean {
    return this.services.some(s => {
      const host = s.addresses?.[0] ?? s.host ?? 'unknown';
      const pinInfo = s.txt?.pin === 'required' ? ' 🔒' : '';
      return `${s.name} (${host}:${s.port})${pinInfo}` === deviceName;
    });
  }

  getServiceByIndex(index: number): { host: string; port: number; pin: boolean } | null {
    const service = this.services[index];
    if (!service) return null;
    return {
      host: service.addresses?.[0] ?? service.host ?? '127.0.0.1',
      port: service.port,
      pin: service.txt?.pin === 'required',
    };
  }

  destroy(): void {
    this.stopBrowsing();
    this.bonjour.destroy();
  }
}
