import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { join } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';

import { MidiMapperApp, type MidiMapperDeps } from '../../src/app/midi-mapper.app.ts';
import { YamlConfigAdapter, YamlConfigWriterAdapter } from '../../src/adapters/yaml-config.adapter.ts';
import { JsonStateAdapter } from '../../src/adapters/json-state.adapter.ts';
import { TcpServer } from '../../src/adapters/network/tcp-server.ts';
import { TcpClient } from '../../src/adapters/network/tcp-client.ts';
import { TcpBroadcastOutputAdapter } from '../../src/adapters/network/tcp-broadcast-output.adapter.ts';
import { TcpClientInputAdapter } from '../../src/adapters/network/tcp-client-input.adapter.ts';
import { MdnsBrowserDiscoveryAdapter } from '../../src/adapters/network/mdns-browser-discovery.adapter.ts';
import { StaticDeviceDiscoveryAdapter } from '../../src/adapters/network/static-device-discovery.adapter.ts';
import type { MidiInputPort, MidiMessageHandler, MidiErrorHandler } from '../../src/ports/midi-input.port.ts';
import type { MidiOutputPort } from '../../src/ports/midi-output.port.ts';
import type { UserInterfacePort } from '../../src/ports/user-interface.port.ts';
import type { MidiDevice } from '../../src/ports/device-discovery.port.ts';
import type { MidiCC } from '../../src/domain/midi-message.ts';
import { encodeCC } from '../../src/domain/network-protocol.ts';

// ---------------------------------------------------------------------------
// Port allocation to avoid conflicts with other test suites
// ---------------------------------------------------------------------------
let PORT = 19200;
const nextPort = () => ++PORT;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

const waitForEvent = (emitter: any, event: string, timeout = 5000) =>
  new Promise<any>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${event}`)), timeout);
    emitter.once(event, (...args: any[]) => { clearTimeout(timer); resolve(args); });
  });

/** Collect messages from a TcpClient until a predicate matches, then return that message. */
const waitForMessage = (client: TcpClient, predicate: (msg: any) => boolean, timeout = 5000) =>
  new Promise<any>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timeout waiting for matching message')), timeout);
    const handler = (msg: any) => {
      if (predicate(msg)) {
        clearTimeout(timer);
        client.removeListener('message', handler);
        resolve(msg);
      }
    };
    client.on('message', handler);
  });

/** Mock MidiInputPort: lets tests inject messages programmatically. */
function createMockMidiInput() {
  let messageHandler: MidiMessageHandler | null = null;
  let errorHandler: MidiErrorHandler | null = null;
  return {
    input: {
      open: mock((_idx: number) => {}),
      close: mock(() => {}),
      onMessage: mock((h: MidiMessageHandler) => { messageHandler = h; }),
      onError: mock((h: MidiErrorHandler) => { errorHandler = h; }),
    } as MidiInputPort,
    inject: (msg: MidiCC) => { messageHandler?.(msg); },
    injectError: (err: Error) => { errorHandler?.(err); },
  };
}

/** Mock MidiOutputPort: captures all sent messages. */
function createMockMidiOutput() {
  const sent: Array<readonly [number, number, number]> = [];
  return {
    output: {
      openVirtual: mock((_name: string) => {}),
      send: mock((msg: readonly [number, number, number]) => { sent.push(msg); }),
      close: mock(() => {}),
    } as MidiOutputPort,
    sent,
  };
}

/** Mock UserInterfacePort. */
function createMockUI() {
  return {
    start: mock(() => {}),
    stop: mock(() => {}),
    waitForExit: mock(() => Promise.resolve()),
    showWelcome: mock(() => Promise.resolve('local' as const)),
    selectDevice: mock((_devices: MidiDevice[]) => Promise.resolve(0)),
    showInfo: mock((_msg: string) => {}),
    showWarning: mock((_msg: string) => {}),
    showError: mock((_msg: string) => {}),
    logMapping: mock((_cc: number, _orig: number, _mapped: number) => {}),
  } satisfies UserInterfacePort;
}

/** Mock MdnsBrowserDiscoveryAdapter that returns a fixed host/port. */
function createMockBrowser(host: string, port: number) {
  const mockBonjour = {
    find: () => new EventEmitter(),
    destroy: () => {},
  } as any;
  const browser = new MdnsBrowserDiscoveryAdapter(mockBonjour);
  browser.getServiceByIndex = (idx: number) =>
    idx === 0 ? { host, port, pin: false } : null;
  browser.listDevices = () => [{ index: 0, name: `Test Host (${host}:${port})` }];
  browser.isDeviceConnected = () => true;
  return browser;
}

// Config YAML templates
const HOST_PASSTHROUGH_CONFIG = `
deviceName: "Host Output"
rules:
  - cc: 4
    label: "Expression"
    inputMin: 0
    inputMax: 127
    outputMin: 0
    outputMax: 127
    curve: linear
`;

const HOST_SCALED_CONFIG = `
deviceName: "Host Scaled"
rules:
  - cc: 4
    label: "Scaled Expression"
    inputMin: 40
    inputMax: 127
    outputMin: 0
    outputMax: 127
    curve: linear
`;

const JOIN_PASSTHROUGH_CONFIG = `
deviceName: "Join Output"
rules:
  - cc: 4
    label: "Expression"
    inputMin: 0
    inputMax: 127
    outputMin: 0
    outputMax: 127
    curve: linear
`;

const JOIN_INVERT_CONFIG = `
deviceName: "Join Inverted"
rules:
  - cc: 4
    label: "Inverted"
    inputMin: 0
    inputMax: 127
    outputMin: 0
    outputMax: 127
    curve: linear
    invert: true
`;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('E2E: Host -> Join Network Flow', () => {
  let tmpDir: string;
  const servers: TcpServer[] = [];
  const clients: TcpClient[] = [];

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'lan-party-buddy-host-join-'));
  });

  afterEach(async () => {
    for (const c of clients) c.disconnect();
    for (const s of servers) s.stop();
    servers.length = 0;
    clients.length = 0;
    await rm(tmpDir, { recursive: true, force: true });
  });

  /**
   * Build the Host side: mock MIDI input -> MidiMapperApp -> TcpBroadcastOutputAdapter (real TCP server).
   * Returns inject function to push messages into the host pipeline.
   */
  async function buildHost(opts: { configYaml: string; port: number; pin?: string }) {
    const configPath = join(tmpDir, 'host-config.yaml');
    await Bun.write(configPath, opts.configYaml);

    const server = new TcpServer(opts.pin);
    servers.push(server);
    server.start(opts.port, 60000); // long heartbeat interval so it doesn't interfere

    const mockInput = createMockMidiInput();
    const broadcastOutput = new TcpBroadcastOutputAdapter(server);
    const discovery = new StaticDeviceDiscoveryAdapter('Host Virtual Device');
    const ui = createMockUI();
    const configReader = new YamlConfigAdapter();
    const configWriter = new YamlConfigWriterAdapter();
    const stateStore = new JsonStateAdapter(join(tmpDir, 'host-state.json'));

    const deps: MidiMapperDeps = {
      midiInput: mockInput.input,
      midiOutput: broadcastOutput,
      deviceDiscovery: discovery,
      ui,
      configReader,
      configWriter,
      stateStore,
    };

    // pollIntervalMs very high so the device loop doesn't auto-disconnect
    const app = new MidiMapperApp(deps, 999999);
    // Start app in background (it runs the device loop forever)
    const runPromise = app.run(configPath, true);

    // Give it a moment to wire up handlers
    await wait(50);

    return { app, server, mockInput, broadcastOutput, ui, runPromise };
  }

  /**
   * Build the Join side: TcpClientInputAdapter (real TCP client) -> MidiMapperApp -> mock MIDI output.
   * Returns the mock output to verify captured messages.
   */
  async function buildJoin(opts: {
    configYaml: string;
    hostPort: number;
    pin?: string;
    suffix?: string;
  }) {
    const suffix = opts.suffix ?? '';
    const configPath = join(tmpDir, `join-config${suffix}.yaml`);
    await Bun.write(configPath, opts.configYaml);

    const tcpClient = new TcpClient();
    clients.push(tcpClient);
    const browser = createMockBrowser('127.0.0.1', opts.hostPort);
    const tcpInput = new TcpClientInputAdapter(tcpClient, browser);
    const mockOutput = createMockMidiOutput();
    const ui = createMockUI();
    const configReader = new YamlConfigAdapter();
    const configWriter = new YamlConfigWriterAdapter();
    const stateStore = new JsonStateAdapter(join(tmpDir, `join-state${suffix}.json`));

    const deps: MidiMapperDeps = {
      midiInput: tcpInput,
      midiOutput: mockOutput.output,
      deviceDiscovery: browser,
      ui,
      configReader,
      configWriter,
      stateStore,
    };

    const app = new MidiMapperApp(deps, 999999);
    const runPromise = app.run(configPath, true);

    // Wait for TCP connection to establish
    await wait(150);

    return { app, tcpClient, tcpInput, mockOutput, ui, runPromise };
  }

  // -------------------------------------------------------------------------

  it('Host sends mapped CC, Join receives it on virtual output', async () => {
    const p = nextPort();

    const host = await buildHost({
      configYaml: HOST_PASSTHROUGH_CONFIG,
      port: p,
    });

    const join = await buildJoin({
      configYaml: JOIN_PASSTHROUGH_CONFIG,
      hostPort: p,
    });

    // Wait for join client to fully connect
    await wait(100);

    // Host side: inject CC 4 value 64
    host.mockInput.inject({ channel: 0, cc: 4, value: 64 });

    // Give TCP time to deliver
    await wait(150);

    // Join side: the mock output should have received the message.
    // The mapping engine adds NRPN preamble messages + the main CC.
    // On the join side, the TCP input receives { channel: 0, cc: 4, value: 64 }
    // which goes through the join's mapping engine, producing NRPN preamble + CC 4.
    const cc4Messages = join.mockOutput.sent.filter(m => m[1] === 4);
    expect(cc4Messages.length).toBeGreaterThanOrEqual(1);
    expect(cc4Messages[0]).toEqual([0xb0, 4, 64]);
  });

  // -------------------------------------------------------------------------

  it('Host with mapping rule transforms before sending to network', async () => {
    const p = nextPort();

    // Host config: CC 4, input [40,127] -> output [0,127] (scaled)
    const host = await buildHost({
      configYaml: HOST_SCALED_CONFIG,
      port: p,
    });

    const join = await buildJoin({
      configYaml: JOIN_PASSTHROUGH_CONFIG,
      hostPort: p,
    });

    await wait(100);

    // Inject CC 4 value 80 into host
    // With input range [40,127] -> output [0,127]:
    // mapped = (80 - 40) / (127 - 40) * 127 = 40/87 * 127 ~ 58
    host.mockInput.inject({ channel: 0, cc: 4, value: 80 });

    await wait(150);

    // The host maps 80 -> ~58, sends that over TCP.
    // The join receives ~58 and passes through linearly.
    const cc4Messages = join.mockOutput.sent.filter(m => m[1] === 4);
    expect(cc4Messages.length).toBeGreaterThanOrEqual(1);

    // The mapped value should NOT be 80 (it was transformed by the host)
    const receivedValue = cc4Messages[0]![2];
    expect(receivedValue).not.toBe(80);
    // Expected: round((80-40)/(127-40) * 127) = round(40/87 * 127) = round(58.39) = 58
    expect(receivedValue).toBe(58);
  });

  // -------------------------------------------------------------------------

  it('Join with mapping rule transforms after receiving from network', async () => {
    const p = nextPort();

    // Host: passthrough for CC 4 (linear 0-127 -> 0-127)
    const host = await buildHost({
      configYaml: HOST_PASSTHROUGH_CONFIG,
      port: p,
    });

    // Join: CC 4 with invert
    const join = await buildJoin({
      configYaml: JOIN_INVERT_CONFIG,
      hostPort: p,
    });

    await wait(100);

    // Host sends CC 4 value 100 (passes through as 100)
    host.mockInput.inject({ channel: 0, cc: 4, value: 100 });

    await wait(150);

    // Join receives 100, applies invert (0-127 -> 127-0), output = 127 - 100 = 27
    const cc4Messages = join.mockOutput.sent.filter(m => m[1] === 4);
    expect(cc4Messages.length).toBeGreaterThanOrEqual(1);
    expect(cc4Messages[0]![2]).toBe(27);
  });

  // -------------------------------------------------------------------------

  it('multiple clients receive the same broadcast', async () => {
    const p = nextPort();

    const host = await buildHost({
      configYaml: HOST_PASSTHROUGH_CONFIG,
      port: p,
    });

    // Two join clients
    const join1 = await buildJoin({
      configYaml: JOIN_PASSTHROUGH_CONFIG,
      hostPort: p,
      suffix: '-1',
    });

    const join2 = await buildJoin({
      configYaml: JOIN_PASSTHROUGH_CONFIG,
      hostPort: p,
      suffix: '-2',
    });

    await wait(100);

    // Host sends CC 4 value 50
    host.mockInput.inject({ channel: 0, cc: 4, value: 50 });

    await wait(200);

    // Both joins should receive it
    const cc4Join1 = join1.mockOutput.sent.filter(m => m[1] === 4);
    const cc4Join2 = join2.mockOutput.sent.filter(m => m[1] === 4);

    expect(cc4Join1.length).toBeGreaterThanOrEqual(1);
    expect(cc4Join2.length).toBeGreaterThanOrEqual(1);
    expect(cc4Join1[0]).toEqual([0xb0, 4, 50]);
    expect(cc4Join2[0]).toEqual([0xb0, 4, 50]);
  });

  // -------------------------------------------------------------------------

  it('PIN authentication: correct PIN allows connection', async () => {
    const p = nextPort();

    const host = await buildHost({
      configYaml: HOST_PASSTHROUGH_CONFIG,
      port: p,
      pin: '1234',
    });

    // Join connects with correct PIN.
    // We need to manually handle PIN since TcpClientInputAdapter.open()
    // connects without PIN by design (PIN handled by bootstrap).
    // So we connect the TcpClient directly with PIN, then wire up the adapter.
    const tcpClient = new TcpClient();
    clients.push(tcpClient);
    const connected = await tcpClient.connect('127.0.0.1', p, '1234');
    expect(connected).toBe(true);

    await wait(50);

    // Now send a CC from host and verify the client receives it.
    // The host mapping engine produces NRPN preamble (CC 99, CC 100) before CC 4,
    // so we wait for the specific CC 4 message.
    const msgPromise = waitForMessage(tcpClient, m => m.type === 'cc' && m.cc === 4);
    host.mockInput.inject({ channel: 0, cc: 4, value: 77 });
    const msg = await msgPromise;
    expect(msg).toEqual({ type: 'cc', channel: 0, cc: 4, value: 77 });
  });

  // -------------------------------------------------------------------------

  it('PIN authentication: wrong PIN rejected', async () => {
    const p = nextPort();

    await buildHost({
      configYaml: HOST_PASSTHROUGH_CONFIG,
      port: p,
      pin: '1234',
    });

    const tcpClient = new TcpClient();
    clients.push(tcpClient);
    const connected = await tcpClient.connect('127.0.0.1', p, '9999');
    expect(connected).toBe(false);
    expect(tcpClient.isConnected).toBe(false);
  });

  // -------------------------------------------------------------------------

  it('handles disconnect and reconnect', async () => {
    const p1 = nextPort();
    const p2 = nextPort();

    // Start first host
    const host1 = await buildHost({
      configYaml: HOST_PASSTHROUGH_CONFIG,
      port: p1,
    });

    // Connect a raw TCP client (simpler for disconnect/reconnect testing)
    const tcpClient = new TcpClient();
    clients.push(tcpClient);
    await tcpClient.connect('127.0.0.1', p1);
    await wait(50);

    // Verify host sends a message and client receives it.
    // Wait for the specific CC 4 message (skipping NRPN preamble).
    const msg1Promise = waitForMessage(tcpClient, m => m.type === 'cc' && m.cc === 4);
    host1.mockInput.inject({ channel: 0, cc: 4, value: 10 });
    const msg1 = await msg1Promise;
    expect(msg1).toEqual({ type: 'cc', channel: 0, cc: 4, value: 10 });

    // Host shuts down -> client detects disconnect
    const disconnectPromise = waitForEvent(tcpClient, 'disconnected');
    host1.server.stop();
    await disconnectPromise;
    expect(tcpClient.isConnected).toBe(false);

    // Start new host on new port (simulating restart)
    const host2 = await buildHost({
      configYaml: HOST_PASSTHROUGH_CONFIG,
      port: p2,
    });

    // Client reconnects to new host
    const tcpClient2 = new TcpClient();
    clients.push(tcpClient2);
    const reconnected = await tcpClient2.connect('127.0.0.1', p2);
    expect(reconnected).toBe(true);

    await wait(50);

    // Verify new host can send messages
    const msg2Promise = waitForMessage(tcpClient2, m => m.type === 'cc' && m.cc === 4);
    host2.mockInput.inject({ channel: 0, cc: 4, value: 99 });
    const msg2 = await msg2Promise;
    expect(msg2).toEqual({ type: 'cc', channel: 0, cc: 4, value: 99 });
  });

  // -------------------------------------------------------------------------

  it('high throughput: 100 messages without loss', async () => {
    const p = nextPort();

    const host = await buildHost({
      configYaml: HOST_PASSTHROUGH_CONFIG,
      port: p,
    });

    const join = await buildJoin({
      configYaml: JOIN_PASSTHROUGH_CONFIG,
      hostPort: p,
    });

    await wait(100);

    const MESSAGE_COUNT = 100;

    // Host sends 100 CC messages rapidly
    for (let i = 0; i < MESSAGE_COUNT; i++) {
      host.mockInput.inject({ channel: 0, cc: 4, value: i % 128 });
    }

    // Wait for all messages to propagate through TCP
    await wait(500);

    // Each host message goes through the host mapping engine which produces:
    // - NRPN preamble (2 messages: CC 99 and CC 100)
    // - Main CC 4 message
    // Then TCP broadcasts the CC 4 message only (the adapter calls send() for each output message,
    // but only the CC encoded via encodeCC goes over the wire).
    //
    // Actually, the TcpBroadcastOutputAdapter.send() is called for EACH outputMessage from the engine.
    // The engine produces 3 output messages per input: [status, 99, X], [status, 100, Y], [status, 4, val].
    // Each gets broadcast via TCP as an encoded CC.
    //
    // On the join side, each received CC goes through the join's mapping engine.
    // So we should see CC 4 messages in the join output.
    const cc4Messages = join.mockOutput.sent.filter(m => m[1] === 4);
    expect(cc4Messages.length).toBe(MESSAGE_COUNT);

    // Verify the values are correct (the NRPN messages also arrive and get processed,
    // but we only check CC 4)
    for (let i = 0; i < MESSAGE_COUNT; i++) {
      expect(cc4Messages[i]![2]).toBe(i % 128);
    }
  });
});
