import { afterEach, describe, expect, it } from 'bun:test';
import { TcpClient } from '@adapters/network/tcp-client';
import { TcpServer } from '@adapters/network/tcp-server';
import { encodeCC, encodeDisconnect } from '@domain/network-protocol';

const PORT_BASE = 19000; // avoid conflicts
let port = PORT_BASE;
const nextPort = () => ++port;

// Helper to wait for events
const waitForEvent = (emitter: any, event: string, timeout = 2000) =>
  new Promise<any>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${event}`)), timeout);
    emitter.once(event, (...args: any[]) => {
      clearTimeout(timer);
      resolve(args);
    });
  });

describe('TCP Server + Client Integration', () => {
  const servers: TcpServer[] = [];
  const clients: TcpClient[] = [];

  afterEach(() => {
    for (const c of clients) c.disconnect();
    for (const s of servers) s.stop();
    servers.length = 0;
    clients.length = 0;
  });

  // Open mode (no PIN)
  it('client connects to server without PIN', async () => {
    const p = nextPort();
    const server = new TcpServer();
    servers.push(server);
    server.start(p);

    const client = new TcpClient();
    clients.push(client);
    const connected = await client.connect('127.0.0.1', p);
    expect(connected).toBe(true);
    expect(client.isConnected).toBe(true);
  });

  it('server broadcasts messages to connected client', async () => {
    const p = nextPort();
    const server = new TcpServer();
    servers.push(server);
    server.start(p);

    const client = new TcpClient();
    clients.push(client);
    await client.connect('127.0.0.1', p);
    await new Promise((r) => setTimeout(r, 50));

    const msgPromise = waitForEvent(client, 'message');
    server.broadcast(encodeCC(0, 10, 64));
    const [msg] = await msgPromise;
    expect(msg).toEqual({ type: 'cc', channel: 0, cc: 10, value: 64 });
  });

  it('server broadcasts to multiple clients', async () => {
    const p = nextPort();
    const server = new TcpServer();
    servers.push(server);
    server.start(p);

    const client1 = new TcpClient();
    const client2 = new TcpClient();
    clients.push(client1, client2);
    await client1.connect('127.0.0.1', p);
    await client2.connect('127.0.0.1', p);

    await new Promise((r) => setTimeout(r, 50));
    expect(server.getClientCount()).toBe(2);

    const p1 = waitForEvent(client1, 'message');
    const p2 = waitForEvent(client2, 'message');
    server.broadcast(encodeCC(1, 20, 100));
    const [m1] = await p1;
    const [m2] = await p2;
    expect(m1).toEqual({ type: 'cc', channel: 1, cc: 20, value: 100 });
    expect(m2).toEqual({ type: 'cc', channel: 1, cc: 20, value: 100 });
  });

  // PIN mode
  it('client authenticates with correct PIN', async () => {
    const p = nextPort();
    const server = new TcpServer('1234');
    servers.push(server);
    server.start(p);

    const client = new TcpClient();
    clients.push(client);
    const connected = await client.connect('127.0.0.1', p, '1234');
    expect(connected).toBe(true);
    expect(client.isConnected).toBe(true);
  });

  it('client rejected with wrong PIN', async () => {
    const p = nextPort();
    const server = new TcpServer('1234');
    servers.push(server);
    server.start(p);

    const client = new TcpClient();
    clients.push(client);
    const connected = await client.connect('127.0.0.1', p, '9999');
    expect(connected).toBe(false);
    expect(client.isConnected).toBe(false);
  });

  it('receives messages after PIN auth', async () => {
    const p = nextPort();
    const server = new TcpServer('4321');
    servers.push(server);
    server.start(p);

    const client = new TcpClient();
    clients.push(client);
    await client.connect('127.0.0.1', p, '4321');

    await new Promise((r) => setTimeout(r, 50));
    const msgPromise = waitForEvent(client, 'message');
    server.broadcast(encodeCC(0, 5, 127));
    const [msg] = await msgPromise;
    expect(msg).toEqual({ type: 'cc', channel: 0, cc: 5, value: 127 });
  });

  // Disconnect
  it('detects client disconnect', async () => {
    const p = nextPort();
    const server = new TcpServer();
    servers.push(server);
    server.start(p);

    const client = new TcpClient();
    clients.push(client);
    await client.connect('127.0.0.1', p);
    await new Promise((r) => setTimeout(r, 50));

    expect(server.getClientCount()).toBe(1);
    const disconnectPromise = waitForEvent(server, 'clientDisconnected');
    client.disconnect();
    await disconnectPromise;
    expect(server.getClientCount()).toBe(0);
  });

  it('client detects server shutdown', async () => {
    const p = nextPort();
    const server = new TcpServer();
    servers.push(server);
    server.start(p);

    const client = new TcpClient();
    clients.push(client);
    await client.connect('127.0.0.1', p);

    const disconnectPromise = waitForEvent(client, 'disconnected');
    server.stop();
    await disconnectPromise;
    expect(client.isConnected).toBe(false);
  });

  // Server getClients
  it('getClients returns authenticated client info', async () => {
    const p = nextPort();
    const server = new TcpServer();
    servers.push(server);
    server.start(p);

    const client = new TcpClient();
    clients.push(client);
    await client.connect('127.0.0.1', p);
    await new Promise((r) => setTimeout(r, 50));

    const clients_list = server.getClients();
    expect(clients_list.length).toBe(1);
    expect(clients_list[0]!.address).toContain('127.0.0.1');
  });

  // Client sends to server
  it('client can send messages to server (duplex)', async () => {
    const p = nextPort();
    const server = new TcpServer();
    servers.push(server);
    server.start(p);

    const client = new TcpClient();
    clients.push(client);
    await client.connect('127.0.0.1', p);
    await new Promise((r) => setTimeout(r, 50));

    const msgPromise = waitForEvent(server, 'message');
    client.send(encodeCC(2, 30, 90));
    const [msg, clientId] = await msgPromise;
    expect(msg).toEqual({ type: 'cc', channel: 2, cc: 30, value: 90 });
    expect(typeof clientId).toBe('string');
  });

  // Client handles disconnect message from server
  it('client disconnects when receiving disconnect message', async () => {
    const p = nextPort();
    const server = new TcpServer();
    servers.push(server);
    server.start(p);

    const client = new TcpClient();
    clients.push(client);
    await client.connect('127.0.0.1', p);
    await new Promise((r) => setTimeout(r, 50));

    const disconnectPromise = waitForEvent(client, 'disconnected');
    server.broadcast(encodeDisconnect());
    await disconnectPromise;
    expect(client.isConnected).toBe(false);
  });

  // Client send when not connected is a no-op
  it('client send is no-op when disconnected', () => {
    const client = new TcpClient();
    clients.push(client);
    // Should not throw
    client.send(encodeCC(0, 1, 2));
    expect(client.isConnected).toBe(false);
  });

  // Client connection error to non-existent server
  it('client returns false when connection fails', async () => {
    const client = new TcpClient();
    clients.push(client);
    // Must listen for 'error' to prevent EventEmitter from throwing
    const errors: Error[] = [];
    client.on('error', (err) => errors.push(err));
    const connected = await client.connect('127.0.0.1', 19999);
    expect(connected).toBe(false);
    expect(client.isConnected).toBe(false);
    expect(errors.length).toBe(1);
  });

  // Heartbeat
  it('server sends heartbeat to connected clients', async () => {
    const p = nextPort();
    const server = new TcpServer();
    servers.push(server);
    server.start(p, 100); // 100ms heartbeat for fast test

    const client = new TcpClient();
    clients.push(client);
    await client.connect('127.0.0.1', p);
    await new Promise((r) => setTimeout(r, 50));

    const msgPromise = waitForEvent(client, 'message');
    const [msg] = await msgPromise;
    expect(msg).toEqual({ type: 'heartbeat' });
  });

  // Socket error handling via buildSocketHandlers
  it('server emits error on socket error', () => {
    const server = new TcpServer();
    servers.push(server);
    const errors: Error[] = [];
    server.on('error', (err) => errors.push(err));
    const handlers = server.buildSocketHandlers();
    handlers.error({} as any, new Error('test socket error'));
    expect(errors.length).toBe(1);
    expect(errors[0]!.message).toBe('test socket error');
  });

  it('client emits error on socket error', () => {
    const client = new TcpClient();
    clients.push(client);
    const errors: Error[] = [];
    client.on('error', (err) => errors.push(err));
    let resolved = false;
    const handlers = client.buildSocketHandlers((val) => {
      resolved = true;
    });
    handlers.error({} as any, new Error('test socket error'));
    expect(errors.length).toBe(1);
    expect(errors[0]!.message).toBe('test socket error');
    expect(resolved).toBe(true);
  });

  // Server stop cleans up
  it('stop cleans up all resources', async () => {
    const p = nextPort();
    const server = new TcpServer();
    servers.push(server);
    server.start(p);

    const client = new TcpClient();
    clients.push(client);
    await client.connect('127.0.0.1', p);

    server.stop();
    expect(server.getClientCount()).toBe(0);
  });
});
