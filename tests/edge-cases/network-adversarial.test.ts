import { afterEach, describe, expect, it } from 'bun:test';
import { TcpClient } from '@adapters/network/tcp-client';
import { TcpServer } from '@adapters/network/tcp-server';
import type { NetworkMessage } from '@domain/network-protocol';
import { encodeCC, encodeDisconnect, encodeHeartbeat, encodePinChallenge, MSG_CC } from '@domain/network-protocol';

// ---------------------------------------------------------------------------
// Port allocation — starts at 19300 to avoid conflicts with other suites
// ---------------------------------------------------------------------------
let PORT = 19300;
const nextPort = () => ++PORT;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const waitForEvent = (emitter: any, event: string, timeout = 2000) =>
  new Promise<any>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${event}`)), timeout);
    emitter.once(event, (...args: any[]) => {
      clearTimeout(timer);
      resolve(args);
    });
  });

/** Collect N messages from an emitter */
const collectMessages = (emitter: any, event: string, count: number, timeout = 5000) =>
  new Promise<any[]>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout: got ${msgs.length}/${count} messages`)), timeout);
    const msgs: any[] = [];
    const handler = (...args: any[]) => {
      msgs.push(args);
      if (msgs.length >= count) {
        clearTimeout(timer);
        emitter.removeListener(event, handler);
        resolve(msgs);
      }
    };
    emitter.on(event, handler);
  });

// ---------------------------------------------------------------------------

describe('Network Edge Cases', () => {
  const servers: TcpServer[] = [];
  const clients: TcpClient[] = [];

  afterEach(() => {
    for (const c of clients) c.disconnect();
    for (const s of servers) s.stop();
    servers.length = 0;
    clients.length = 0;
  });

  // -----------------------------------------------------------------------
  // Protocol edge cases
  // -----------------------------------------------------------------------

  it('server handles partial frames (2 bytes then 2 bytes)', async () => {
    const p = nextPort();
    const server = new TcpServer();
    servers.push(server);
    server.start(p, 60000);

    const msgPromise = waitForEvent(server, 'message', 3000);

    // Connect a raw TCP socket using Bun.connect
    const rawSocket = await Bun.connect<Record<string, never>>({
      hostname: '127.0.0.1',
      port: p,
      socket: {
        open() {},
        data() {},
        close() {},
        error() {},
      },
      data: {},
    });

    await wait(50);

    // Send first 2 bytes of a CC frame: [MSG_CC, channel=0]
    rawSocket.write(new Uint8Array([MSG_CC, 0x00]));
    await wait(50);

    // Send remaining 2 bytes: [cc=10, value=64]
    rawSocket.write(new Uint8Array([0x0a, 0x40]));

    // Server should buffer and process the complete frame
    const [msg] = await msgPromise;
    expect(msg).toEqual({ type: 'cc', channel: 0, cc: 10, value: 64 });

    rawSocket.end();
  });

  it('server handles multiple frames in single TCP packet', async () => {
    const p = nextPort();
    const server = new TcpServer();
    servers.push(server);
    server.start(p, 60000);

    // Connect raw socket
    const rawSocket = await Bun.connect<Record<string, never>>({
      hostname: '127.0.0.1',
      port: p,
      socket: {
        open() {},
        data() {},
        close() {},
        error() {},
      },
      data: {},
    });

    await wait(50);

    const msgsPromise = collectMessages(server, 'message', 3, 3000);

    // Send 12 bytes (3 CC frames concatenated) in one write
    const combined = new Uint8Array(12);
    combined.set(encodeCC(0, 10, 64), 0);
    combined.set(encodeCC(1, 20, 100), 4);
    combined.set(encodeCC(2, 30, 127), 8);
    rawSocket.write(combined);

    const msgs = await msgsPromise;
    expect(msgs.length).toBe(3);
    expect(msgs[0]![0]).toEqual({ type: 'cc', channel: 0, cc: 10, value: 64 });
    expect(msgs[1]![0]).toEqual({ type: 'cc', channel: 1, cc: 20, value: 100 });
    expect(msgs[2]![0]).toEqual({ type: 'cc', channel: 2, cc: 30, value: 127 });

    rawSocket.end();
  });

  it('server ignores invalid message types', async () => {
    const p = nextPort();
    const server = new TcpServer();
    servers.push(server);
    server.start(p, 60000);

    const receivedMessages: any[] = [];
    server.on('message', (msg) => receivedMessages.push(msg));

    // Connect raw socket
    const rawSocket = await Bun.connect<Record<string, never>>({
      hostname: '127.0.0.1',
      port: p,
      socket: {
        open() {},
        data() {},
        close() {},
        error() {},
      },
      data: {},
    });

    await wait(50);

    // Send [0x50, 0x00, 0x00, 0x00] — unknown type
    rawSocket.write(new Uint8Array([0x50, 0x00, 0x00, 0x00]));

    await wait(100);

    // Server should not crash, and decodeMessage returns null for unknown type
    expect(receivedMessages.length).toBe(0);

    // Verify server is still operational by sending a valid frame
    const msgPromise = waitForEvent(server, 'message', 2000);
    rawSocket.write(encodeCC(0, 5, 50));
    const [msg] = await msgPromise;
    expect(msg).toEqual({ type: 'cc', channel: 0, cc: 5, value: 50 });

    rawSocket.end();
  });

  it('server handles zero-length data gracefully', async () => {
    const p = nextPort();
    const server = new TcpServer();
    servers.push(server);
    server.start(p, 60000);

    // Connect and immediately disconnect without sending any data
    const rawSocket = await Bun.connect<Record<string, never>>({
      hostname: '127.0.0.1',
      port: p,
      socket: {
        open() {},
        data() {},
        close() {},
        error() {},
      },
      data: {},
    });

    await wait(30);
    rawSocket.end();
    await wait(50);

    // Server should not crash — verify by connecting a real client
    const client = new TcpClient();
    clients.push(client);
    const connected = await client.connect('127.0.0.1', p);
    expect(connected).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Connection edge cases
  // -----------------------------------------------------------------------

  it('client handles connection refused (server not running)', async () => {
    const p = nextPort();
    const client = new TcpClient();
    clients.push(client);

    // Must listen for 'error' to prevent EventEmitter from throwing
    const errors: Error[] = [];
    client.on('error', (err) => errors.push(err));

    // Try to connect to a port with no server
    const connected = await client.connect('127.0.0.1', p);
    expect(connected).toBe(false);
    expect(client.isConnected).toBe(false);
  });

  it('multiple rapid connects/disconnects do not crash server', async () => {
    const p = nextPort();
    const server = new TcpServer();
    servers.push(server);
    server.start(p, 60000);

    // Connect and immediately disconnect 10 times in rapid succession
    const connectionPromises: Promise<void>[] = [];
    for (let i = 0; i < 10; i++) {
      connectionPromises.push(
        (async () => {
          const rawSocket = await Bun.connect<Record<string, never>>({
            hostname: '127.0.0.1',
            port: p,
            socket: {
              open() {},
              data() {},
              close() {},
              error() {},
            },
            data: {},
          });
          rawSocket.end();
        })(),
      );
    }

    await Promise.all(connectionPromises);
    await wait(200);

    // Server should still be operational
    const client = new TcpClient();
    clients.push(client);
    const connected = await client.connect('127.0.0.1', p);
    expect(connected).toBe(true);
    expect(client.isConnected).toBe(true);
  });

  it('server handles client sending data after disconnect message', async () => {
    const p = nextPort();
    const server = new TcpServer();
    servers.push(server);
    server.start(p, 60000);

    // Connect raw socket
    const rawSocket = await Bun.connect<Record<string, never>>({
      hostname: '127.0.0.1',
      port: p,
      socket: {
        open() {},
        data() {},
        close() {},
        error() {},
      },
      data: {},
    });

    await wait(50);

    // Send disconnect frame, then send more data
    rawSocket.write(encodeDisconnect());
    await wait(10);

    // Try sending more data after disconnect — server should handle gracefully
    try {
      rawSocket.write(encodeCC(0, 1, 127));
    } catch {
      // It's okay if write throws after disconnect
    }

    await wait(100);

    // Server should not crash — verify it is still operational
    const client = new TcpClient();
    clients.push(client);
    const connected = await client.connect('127.0.0.1', p);
    expect(connected).toBe(true);
  });

  it('broadcast with no clients is a no-op', () => {
    const server = new TcpServer();
    servers.push(server);

    // Broadcast with 0 connected clients — should not throw
    expect(() => server.broadcast(encodeCC(0, 1, 64))).not.toThrow();
    expect(() => server.broadcast(encodeHeartbeat())).not.toThrow();
    expect(() => server.broadcast(encodeDisconnect())).not.toThrow();
  });

  it('client send() when not connected is a no-op', () => {
    const client = new TcpClient();
    clients.push(client);

    // send() before connecting — should not throw
    expect(() => client.send(encodeCC(0, 1, 64))).not.toThrow();
    expect(client.isConnected).toBe(false);
  });

  // -----------------------------------------------------------------------
  // PIN edge cases
  // -----------------------------------------------------------------------

  it('PIN with special characters is handled', async () => {
    const p = nextPort();
    const server = new TcpServer('!@#$');
    servers.push(server);
    server.start(p, 60000);

    const client = new TcpClient();
    clients.push(client);
    const connected = await client.connect('127.0.0.1', p, '!@#$');
    expect(connected).toBe(true);
    expect(client.isConnected).toBe(true);
  });

  it('empty PIN challenge (client sends empty string) is rejected', async () => {
    const p = nextPort();
    const server = new TcpServer('1234');
    servers.push(server);
    server.start(p, 60000);

    // Connect raw socket and send an empty-ish PIN (4 bytes of '0'-padded empty)
    // encodePinChallenge('') pads to '0000'
    let pinResponseByte: number | null = null;
    const rawSocket = await Bun.connect<Record<string, never>>({
      hostname: '127.0.0.1',
      port: p,
      socket: {
        open() {},
        data(_socket, data) {
          const bytes = new Uint8Array(data as unknown as ArrayBuffer);
          pinResponseByte = bytes[0] ?? null;
        },
        close() {},
        error() {},
      },
      data: {},
    });

    await wait(50);

    // Send the encoded empty PIN (padded to 4 bytes as '0000')
    rawSocket.write(encodePinChallenge(''));

    await wait(100);

    // Server should reject: '0000' !== '1234'
    expect(pinResponseByte).toBe(0x00); // rejected

    rawSocket.end();
  });

  it('PIN-protected server rejects unauthenticated messages', async () => {
    const p = nextPort();
    const server = new TcpServer('1234');
    servers.push(server);
    server.start(p, 60000);

    const receivedMessages: any[] = [];
    server.on('message', (msg) => receivedMessages.push(msg));

    // Connect raw socket and send CC data without proper PIN first
    let pinResponseByte: number | null = null;
    const rawSocket = await Bun.connect<Record<string, never>>({
      hostname: '127.0.0.1',
      port: p,
      socket: {
        open() {},
        data(_socket, data) {
          const bytes = new Uint8Array(data as unknown as ArrayBuffer);
          pinResponseByte = bytes[0] ?? null;
        },
        close() {},
        error() {},
      },
      data: {},
    });

    await wait(50);

    // Send CC data directly — server will treat first 4 bytes as PIN
    // encodeCC(0,10,64) = [0x01, 0x00, 0x0A, 0x40]
    // Decoded as PIN text: some non-matching characters
    rawSocket.write(encodeCC(0, 10, 64));

    await wait(100);

    // Server should reject (the 4 bytes decoded as text won't match '1234')
    expect(pinResponseByte).toBe(0x00); // rejected
    // No CC messages should have been processed
    expect(receivedMessages.length).toBe(0);

    rawSocket.end();
  });

  // -----------------------------------------------------------------------
  // Throughput / stress
  // -----------------------------------------------------------------------

  it('server handles 50 concurrent client connections', async () => {
    const p = nextPort();
    const server = new TcpServer();
    servers.push(server);
    server.start(p, 60000);

    // Connect 50 clients
    const allClients: TcpClient[] = [];
    for (let i = 0; i < 50; i++) {
      const c = new TcpClient();
      allClients.push(c);
      clients.push(c);
      await c.connect('127.0.0.1', p);
    }

    await wait(200);
    expect(server.getClientCount()).toBe(50);

    // Set up message listeners on all clients before broadcasting
    const messagePromises = allClients.map((c) => waitForEvent(c, 'message', 5000));

    // Broadcast one message
    server.broadcast(encodeCC(0, 10, 64));

    // All 50 should receive it
    const results = await Promise.all(messagePromises);
    for (const [msg] of results) {
      expect(msg).toEqual({ type: 'cc', channel: 0, cc: 10, value: 64 });
    }

    // Disconnect all
    for (const c of allClients) {
      c.disconnect();
    }

    await wait(200);
    expect(server.getClientCount()).toBe(0);
  });

  it('1000 messages in rapid succession without data corruption', async () => {
    const p = nextPort();
    const server = new TcpServer();
    servers.push(server);
    server.start(p, 60000);

    const client = new TcpClient();
    clients.push(client);
    await client.connect('127.0.0.1', p);
    await wait(50);

    const MESSAGE_COUNT = 1000;
    const received: NetworkMessage[] = [];

    const allReceived = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Timeout: got ${received.length}/${MESSAGE_COUNT} messages`)),
        10000,
      );
      client.on('message', (msg: NetworkMessage) => {
        if (msg.type === 'cc') {
          received.push(msg);
          if (received.length >= MESSAGE_COUNT) {
            clearTimeout(timer);
            resolve();
          }
        }
      });
    });

    // Send 1000 CC messages with sequential values
    for (let i = 0; i < MESSAGE_COUNT; i++) {
      server.broadcast(encodeCC(0, 1, i % 128));
    }

    await allReceived;

    expect(received.length).toBe(MESSAGE_COUNT);

    // Verify all received in order with correct values
    for (let i = 0; i < MESSAGE_COUNT; i++) {
      const msg = received[i]!;
      expect(msg.type).toBe('cc');
      if (msg.type === 'cc') {
        expect(msg.value).toBe(i % 128);
      }
    }
  });

  // -----------------------------------------------------------------------
  // Protocol robustness
  // -----------------------------------------------------------------------

  it('heartbeat does not trigger message handler on client as non-CC', async () => {
    const p = nextPort();
    const server = new TcpServer();
    servers.push(server);
    server.start(p, 60000);

    const client = new TcpClient();
    clients.push(client);
    await client.connect('127.0.0.1', p);
    await wait(50);

    const receivedMessages: NetworkMessage[] = [];
    client.on('message', (msg: NetworkMessage) => receivedMessages.push(msg));

    // Server sends heartbeat
    server.broadcast(encodeHeartbeat());
    await wait(100);

    // Client DOES emit heartbeat as a 'message' (protocol design),
    // but it should be typed as 'heartbeat', not as 'cc'
    expect(receivedMessages.length).toBe(1);
    expect(receivedMessages[0]!.type).toBe('heartbeat');

    // Verify no CC data leaks from heartbeat
    const ccMessages = receivedMessages.filter((m) => m.type === 'cc');
    expect(ccMessages.length).toBe(0);
  });

  it('disconnect message cleanly closes client connection', async () => {
    const p = nextPort();
    const server = new TcpServer();
    servers.push(server);
    server.start(p, 60000);

    const client = new TcpClient();
    clients.push(client);
    await client.connect('127.0.0.1', p);
    await wait(50);
    expect(client.isConnected).toBe(true);

    // Server sends disconnect frame to client
    const disconnectPromise = waitForEvent(client, 'disconnected', 3000);
    server.broadcast(encodeDisconnect());
    await disconnectPromise;

    expect(client.isConnected).toBe(false);
  });
});
