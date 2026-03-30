import { afterEach, describe, expect, it } from 'bun:test';
import { MdnsAdvertiserAdapter } from '@adapters/network/mdns-advertiser.adapter';
import { MdnsBrowserDiscoveryAdapter } from '@adapters/network/mdns-browser-discovery.adapter';

describe('mDNS Advertiser + Browser Integration', () => {
  const advertisers: MdnsAdvertiserAdapter[] = [];
  const browsers: MdnsBrowserDiscoveryAdapter[] = [];

  afterEach(() => {
    for (const a of advertisers) a.destroy();
    for (const b of browsers) b.destroy();
    advertisers.length = 0;
    browsers.length = 0;
  });

  it('browser discovers advertised service', async () => {
    const advertiser = new MdnsAdvertiserAdapter();
    advertisers.push(advertiser);
    advertiser.advertise(9900, 'Test MIDI Host', false);

    const browser = new MdnsBrowserDiscoveryAdapter();
    browsers.push(browser);
    browser.startBrowsing();

    // Wait for discovery (mDNS can take a moment)
    await new Promise((r) => setTimeout(r, 2000));

    const devices = browser.listDevices();
    expect(devices.length).toBeGreaterThanOrEqual(1);
    const found = devices.some((d) => d.name.includes('Test MIDI Host'));
    expect(found).toBe(true);
  });

  it('browser shows PIN info in device name', async () => {
    const advertiser = new MdnsAdvertiserAdapter();
    advertisers.push(advertiser);
    advertiser.advertise(9901, 'Locked Host', true);

    const browser = new MdnsBrowserDiscoveryAdapter();
    browsers.push(browser);
    browser.startBrowsing();

    await new Promise((r) => setTimeout(r, 2000));

    const devices = browser.listDevices();
    const locked = devices.find((d) => d.name.includes('Locked Host'));
    expect(locked).toBeDefined();
    expect(locked!.name).toContain('🔒');
  });

  it('getServiceByIndex returns host/port/pin info', async () => {
    const advertiser = new MdnsAdvertiserAdapter();
    advertisers.push(advertiser);
    advertiser.advertise(9902, 'Info Host', false);

    const browser = new MdnsBrowserDiscoveryAdapter();
    browsers.push(browser);
    browser.startBrowsing();

    await new Promise((r) => setTimeout(r, 2000));

    const devices = browser.listDevices();
    const idx = devices.findIndex((d) => d.name.includes('Info Host'));
    expect(idx).toBeGreaterThanOrEqual(0);

    const info = browser.getServiceByIndex(idx);
    expect(info).not.toBeNull();
    expect(info!.port).toBe(9902);
    expect(info!.pin).toBe(false);
  });

  it('isDeviceConnected returns true for visible service', async () => {
    const advertiser = new MdnsAdvertiserAdapter();
    advertisers.push(advertiser);
    advertiser.advertise(9903, 'Visible Host', false);

    const browser = new MdnsBrowserDiscoveryAdapter();
    browsers.push(browser);
    browser.startBrowsing();

    await new Promise((r) => setTimeout(r, 2000));

    const devices = browser.listDevices();
    const device = devices.find((d) => d.name.includes('Visible Host'));
    expect(device).toBeDefined();
    expect(browser.isDeviceConnected(device!.name)).toBe(true);
    expect(browser.isDeviceConnected('nonexistent')).toBe(false);
  });
});
