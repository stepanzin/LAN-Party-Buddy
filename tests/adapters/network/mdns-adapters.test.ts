import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { EventEmitter } from 'node:events';
import { MdnsAdvertiserAdapter } from '../../../src/adapters/network/mdns-advertiser.adapter';
import { MdnsBrowserDiscoveryAdapter } from '../../../src/adapters/network/mdns-browser-discovery.adapter';

// --- Mock Bonjour ---

function createMockBonjour() {
  const publishedServices: any[] = [];
  const browsers: EventEmitter[] = [];

  const mockBonjour = {
    publish: mock((opts: any) => {
      const svc = { ...opts, stop: mock(() => {}) };
      publishedServices.push(svc);
      return svc;
    }),
    find: mock((_opts: any) => {
      const browser = new EventEmitter();
      (browser as any).stop = mock(() => {});
      browsers.push(browser);
      return browser;
    }),
    destroy: mock(() => {}),
  };

  return { mockBonjour: mockBonjour as any, publishedServices, browsers };
}

// --- Advertiser ---

describe('MdnsAdvertiserAdapter', () => {
  it('publishes midi-mapper service with correct metadata', () => {
    const { mockBonjour, publishedServices } = createMockBonjour();
    const adapter = new MdnsAdvertiserAdapter(mockBonjour);

    adapter.advertise(9900, 'My Host', false);

    expect(mockBonjour.publish).toHaveBeenCalledTimes(1);
    expect(publishedServices[0].name).toBe('My Host');
    expect(publishedServices[0].type).toBe('lan-party-buddy');
    expect(publishedServices[0].port).toBe(9900);
    expect(publishedServices[0].txt.pin).toBe('open');
    expect(publishedServices[0].txt.version).toBe('1');

    adapter.destroy();
  });

  it('sets pin=required when pinRequired is true', () => {
    const { mockBonjour, publishedServices } = createMockBonjour();
    const adapter = new MdnsAdvertiserAdapter(mockBonjour);

    adapter.advertise(9901, 'Locked', true);

    expect(publishedServices[0].txt.pin).toBe('required');

    adapter.destroy();
  });

  it('stops previous service before re-advertising', () => {
    const { mockBonjour, publishedServices } = createMockBonjour();
    const adapter = new MdnsAdvertiserAdapter(mockBonjour);

    adapter.advertise(9900, 'First', false);
    adapter.advertise(9901, 'Second', false);

    expect(publishedServices[0].stop).toHaveBeenCalled();
    expect(publishedServices.length).toBe(2);

    adapter.destroy();
  });

  it('stopAdvertising stops the service', () => {
    const { mockBonjour, publishedServices } = createMockBonjour();
    const adapter = new MdnsAdvertiserAdapter(mockBonjour);

    adapter.advertise(9900, 'X', false);
    adapter.stopAdvertising();

    expect(publishedServices[0].stop).toHaveBeenCalled();

    adapter.destroy();
  });

  it('destroy calls bonjour.destroy', () => {
    const { mockBonjour } = createMockBonjour();
    const adapter = new MdnsAdvertiserAdapter(mockBonjour);

    adapter.destroy();

    expect(mockBonjour.destroy).toHaveBeenCalled();
  });
});

// --- Browser Discovery ---

describe('MdnsBrowserDiscoveryAdapter', () => {
  it('starts browsing for midi-mapper services', () => {
    const { mockBonjour } = createMockBonjour();
    const adapter = new MdnsBrowserDiscoveryAdapter(mockBonjour);

    adapter.startBrowsing();

    expect(mockBonjour.find).toHaveBeenCalledWith({ type: 'lan-party-buddy' });

    adapter.destroy();
  });

  it('listDevices returns empty before any service found', () => {
    const { mockBonjour } = createMockBonjour();
    const adapter = new MdnsBrowserDiscoveryAdapter(mockBonjour);
    adapter.startBrowsing();

    expect(adapter.listDevices()).toEqual([]);

    adapter.destroy();
  });

  it('listDevices returns discovered services', () => {
    const { mockBonjour, browsers } = createMockBonjour();
    const adapter = new MdnsBrowserDiscoveryAdapter(mockBonjour);
    adapter.startBrowsing();

    // Simulate service found
    browsers[0]!.emit('up', {
      name: 'Studio Mac',
      host: 'studio.local',
      port: 9900,
      addresses: ['192.168.1.10'],
      txt: { pin: 'open', version: '1' },
    });

    const devices = adapter.listDevices();
    expect(devices).toHaveLength(1);
    expect(devices[0]!.name).toContain('Studio Mac');
    expect(devices[0]!.name).toContain('192.168.1.10:9900');
    expect(devices[0]!.index).toBe(0);

    adapter.destroy();
  });

  it('shows lock icon for PIN-required services', () => {
    const { mockBonjour, browsers } = createMockBonjour();
    const adapter = new MdnsBrowserDiscoveryAdapter(mockBonjour);
    adapter.startBrowsing();

    browsers[0]!.emit('up', {
      name: 'Locked Host',
      host: 'locked.local',
      port: 9901,
      addresses: ['192.168.1.20'],
      txt: { pin: 'required' },
    });

    const devices = adapter.listDevices();
    expect(devices[0]!.name).toContain('🔒');

    adapter.destroy();
  });

  it('deduplicates services by name', () => {
    const { mockBonjour, browsers } = createMockBonjour();
    const adapter = new MdnsBrowserDiscoveryAdapter(mockBonjour);
    adapter.startBrowsing();

    const svc = { name: 'Dup', host: 'x.local', port: 9900, addresses: ['1.2.3.4'], txt: {} };
    browsers[0]!.emit('up', svc);
    browsers[0]!.emit('up', svc);

    expect(adapter.listDevices()).toHaveLength(1);

    adapter.destroy();
  });

  it('removes service on "down" event', () => {
    const { mockBonjour, browsers } = createMockBonjour();
    const adapter = new MdnsBrowserDiscoveryAdapter(mockBonjour);
    adapter.startBrowsing();

    const svc = { name: 'Gone', host: 'x.local', port: 9900, addresses: ['1.2.3.4'], txt: {} };
    browsers[0]!.emit('up', svc);
    expect(adapter.listDevices()).toHaveLength(1);

    browsers[0]!.emit('down', svc);
    expect(adapter.listDevices()).toHaveLength(0);

    adapter.destroy();
  });

  it('isDeviceConnected returns true for visible service', () => {
    const { mockBonjour, browsers } = createMockBonjour();
    const adapter = new MdnsBrowserDiscoveryAdapter(mockBonjour);
    adapter.startBrowsing();

    browsers[0]!.emit('up', {
      name: 'Visible',
      host: 'v.local',
      port: 9900,
      addresses: ['10.0.0.1'],
      txt: { pin: 'open' },
    });

    const deviceName = adapter.listDevices()[0]!.name;
    expect(adapter.isDeviceConnected(deviceName)).toBe(true);
    expect(adapter.isDeviceConnected('nonexistent')).toBe(false);

    adapter.destroy();
  });

  it('getServiceByIndex returns connection info', () => {
    const { mockBonjour, browsers } = createMockBonjour();
    const adapter = new MdnsBrowserDiscoveryAdapter(mockBonjour);
    adapter.startBrowsing();

    browsers[0]!.emit('up', {
      name: 'Info',
      host: 'info.local',
      port: 9902,
      addresses: ['10.0.0.5'],
      txt: { pin: 'required' },
    });

    const info = adapter.getServiceByIndex(0);
    expect(info).toEqual({ host: '10.0.0.5', port: 9902, pin: true });

    adapter.destroy();
  });

  it('getServiceByIndex returns null for invalid index', () => {
    const { mockBonjour } = createMockBonjour();
    const adapter = new MdnsBrowserDiscoveryAdapter(mockBonjour);
    adapter.startBrowsing();

    expect(adapter.getServiceByIndex(99)).toBeNull();

    adapter.destroy();
  });

  it('stopBrowsing stops the browser', () => {
    const { mockBonjour, browsers } = createMockBonjour();
    const adapter = new MdnsBrowserDiscoveryAdapter(mockBonjour);
    adapter.startBrowsing();

    adapter.stopBrowsing();

    expect((browsers[0] as any).stop).toHaveBeenCalled();

    adapter.destroy();
  });

  it('uses host fallback when no addresses', () => {
    const { mockBonjour, browsers } = createMockBonjour();
    const adapter = new MdnsBrowserDiscoveryAdapter(mockBonjour);
    adapter.startBrowsing();

    browsers[0]!.emit('up', {
      name: 'NoAddr',
      host: 'fallback.local',
      port: 9900,
      txt: {},
    });

    const devices = adapter.listDevices();
    expect(devices[0]!.name).toContain('fallback.local');

    adapter.destroy();
  });
});
