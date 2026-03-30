import { afterEach, describe, expect, it } from 'bun:test';
import { EventEmitter } from 'node:events';
import { MdnsBrowserDiscoveryAdapter } from '@adapters/network/mdns-browser-discovery.adapter';
import { TcpBroadcastOutputAdapter } from '@adapters/network/tcp-broadcast-output.adapter';
import { TcpClient } from '@adapters/network/tcp-client';
import { TcpClientInputAdapter } from '@adapters/network/tcp-client-input.adapter';
import { TcpServer } from '@adapters/network/tcp-server';

// Helper
const waitForEvent = (emitter: any, event: string, timeout = 2000) =>
  new Promise<any>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout: ${event}`)), timeout);
    emitter.once(event, (...args: any[]) => {
      clearTimeout(timer);
      resolve(args);
    });
  });

let PORT = 19100;
const nextPort = () => ++PORT;

describe('TcpBroadcastOutputAdapter (MidiOutputPort)', () => {
  const servers: TcpServer[] = [];
  const clients: TcpClient[] = [];

  afterEach(() => {
    for (const c of clients) c.disconnect();
    for (const s of servers) s.stop();
    servers.length = 0;
    clients.length = 0;
  });

  it('send() broadcasts encoded CC to connected clients', async () => {
    const p = nextPort();
    const server = new TcpServer();
    servers.push(server);
    server.start(p);

    const adapter = new TcpBroadcastOutputAdapter(server);

    const client = new TcpClient();
    clients.push(client);
    await client.connect('127.0.0.1', p);
    await new Promise((r) => setTimeout(r, 50));

    const msgPromise = waitForEvent(client, 'message');
    // Status 0xB0 + channel 0 = 0xB0, CC 10, value 64
    adapter.send([0xb0, 10, 64]);
    const [msg] = await msgPromise;
    expect(msg).toEqual({ type: 'cc', channel: 0, cc: 10, value: 64 });
  });

  it('send() extracts channel from status byte', async () => {
    const p = nextPort();
    const server = new TcpServer();
    servers.push(server);
    server.start(p);

    const adapter = new TcpBroadcastOutputAdapter(server);

    const client = new TcpClient();
    clients.push(client);
    await client.connect('127.0.0.1', p);
    await new Promise((r) => setTimeout(r, 50));

    const msgPromise = waitForEvent(client, 'message');
    // Status 0xB5 = channel 5
    adapter.send([0xb5, 20, 100]);
    const [msg] = await msgPromise;
    expect(msg.channel).toBe(5);
  });

  it('close() stops the server', async () => {
    const p = nextPort();
    const server = new TcpServer();
    servers.push(server);
    server.start(p);

    const adapter = new TcpBroadcastOutputAdapter(server);
    adapter.close();

    expect(server.getClientCount()).toBe(0);
  });

  it('openVirtual is a no-op', () => {
    const server = new TcpServer();
    servers.push(server);
    const adapter = new TcpBroadcastOutputAdapter(server);
    // Should not throw
    adapter.openVirtual('any name');
  });
});

describe('TcpClientInputAdapter (MidiInputPort)', () => {
  const servers: TcpServer[] = [];
  const clients: TcpClient[] = [];

  afterEach(() => {
    for (const c of clients) c.disconnect();
    for (const s of servers) s.stop();
    servers.length = 0;
    clients.length = 0;
  });

  // Create a mock browser that returns fake services
  function createMockBrowser(
    services: Array<{ host: string; port: number; pin: boolean }>,
  ): MdnsBrowserDiscoveryAdapter {
    const mockBonjour = {
      find: () => new EventEmitter(),
      destroy: () => {},
    } as any;
    const browser = new MdnsBrowserDiscoveryAdapter(mockBonjour);
    // Override getServiceByIndex
    browser.getServiceByIndex = (index: number) => services[index] ?? null;
    return browser;
  }

  it('onMessage receives CC from TCP server', async () => {
    const p = nextPort();
    const server = new TcpServer();
    servers.push(server);
    server.start(p);

    const tcpClient = new TcpClient();
    clients.push(tcpClient);
    const browser = createMockBrowser([{ host: '127.0.0.1', port: p, pin: false }]);
    const adapter = new TcpClientInputAdapter(tcpClient, browser);

    const messages: any[] = [];
    adapter.onMessage((msg) => messages.push(msg));

    adapter.open(0); // connects to service at index 0
    await new Promise((r) => setTimeout(r, 100));

    const { encodeCC } = await import('../../../src/domain/network-protocol');
    server.broadcast(encodeCC(0, 7, 100));
    await new Promise((r) => setTimeout(r, 100));

    expect(messages.length).toBe(1);
    expect(messages[0]).toEqual({ channel: 0, cc: 7, value: 100 });
  });

  it('throws on invalid device index', () => {
    const tcpClient = new TcpClient();
    clients.push(tcpClient);
    const browser = createMockBrowser([]);
    const adapter = new TcpClientInputAdapter(tcpClient, browser);

    expect(() => adapter.open(99)).toThrow();
  });

  it('close() disconnects the client', async () => {
    const p = nextPort();
    const server = new TcpServer();
    servers.push(server);
    server.start(p);

    const tcpClient = new TcpClient();
    clients.push(tcpClient);
    const browser = createMockBrowser([{ host: '127.0.0.1', port: p, pin: false }]);
    const adapter = new TcpClientInputAdapter(tcpClient, browser);

    adapter.open(0);
    await new Promise((r) => setTimeout(r, 100));
    expect(tcpClient.isConnected).toBe(true);

    adapter.close();
    expect(tcpClient.isConnected).toBe(false);
  });
});
