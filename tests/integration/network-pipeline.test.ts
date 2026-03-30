import { describe, expect, it } from 'bun:test';
import { EventEmitter } from 'node:events';
import { MdnsBrowserDiscoveryAdapter } from '@adapters/network/mdns-browser-discovery.adapter';
import { TcpBroadcastOutputAdapter } from '@adapters/network/tcp-broadcast-output.adapter';
import { TcpClient } from '@adapters/network/tcp-client';
import { TcpClientInputAdapter } from '@adapters/network/tcp-client-input.adapter';
import { TcpServer } from '@adapters/network/tcp-server';
import { buildRules } from '@app/rule-compiler';
import type { AppConfig } from '@domain/config';
import { INITIAL_ENGINE_STATE, processMidiMessage } from '@domain/mapping-engine';
import type { MidiCC } from '@domain/midi-message';

// Use ports from 19400
let PORT = 19400;
const nextPort = () => ++PORT;

function createMockBrowser(host: string, port: number) {
  const mockBonjour = { find: () => new EventEmitter(), destroy: () => {} } as any;
  const browser = new MdnsBrowserDiscoveryAdapter(mockBonjour);
  browser.getServiceByIndex = (idx: number) => (idx === 0 ? { host, port, pin: false } : null);
  browser.listDevices = () => [{ index: 0, name: `Host (${host}:${port})` }];
  browser.isDeviceConnected = () => true;
  return browser;
}

describe('Integration: Network Pipeline (adapters only, no MidiMapperApp)', () => {
  it('CC message flows through: encode → TCP → decode → MidiCC', async () => {
    const p = nextPort();
    const server = new TcpServer();
    server.start(p);
    const output = new TcpBroadcastOutputAdapter(server);

    const client = new TcpClient();
    const browser = createMockBrowser('127.0.0.1', p);
    const input = new TcpClientInputAdapter(client, browser);

    const received: MidiCC[] = [];
    input.onMessage((msg) => received.push(msg));
    input.open(0);
    await new Promise((r) => setTimeout(r, 100));

    // Send as raw MIDI: status=0xB2 (channel 2), CC 10, value 64
    output.send([0xb2, 10, 64]);
    await new Promise((r) => setTimeout(r, 100));

    expect(received.length).toBe(1);
    expect(received[0]).toEqual({ channel: 2, cc: 10, value: 64 });

    input.close();
    output.close();
  });

  it('CC → encode → TCP → decode → mapping engine → output', async () => {
    // Full chain: raw CC → network → engine with rules → mapped output
    const p = nextPort();
    const server = new TcpServer();
    server.start(p);
    const networkOutput = new TcpBroadcastOutputAdapter(server);

    const client = new TcpClient();
    const browser = createMockBrowser('127.0.0.1', p);
    const networkInput = new TcpClientInputAdapter(client, browser);

    const config: AppConfig = {
      deviceName: 'Test',
      mode: 'local',
      rules: [
        {
          cc: 10,
          label: 'Test Rule',
          inputMin: 0,
          inputMax: 127,
          outputMin: 0,
          outputMax: 64,
          curve: 'linear',
        },
      ],
    };
    const rules = buildRules(config);

    const mapped: number[] = [];
    networkInput.onMessage((msg) => {
      const { result } = processMidiMessage(msg, rules, {}, INITIAL_ENGINE_STATE);
      mapped.push(result.log.mappedValue);
    });

    networkInput.open(0);
    await new Promise((r) => setTimeout(r, 100));

    // Send CC 10, value 127 → should map to 64 (linear 0-127 → 0-64)
    networkOutput.send([0xb0, 10, 127]);
    await new Promise((r) => setTimeout(r, 100));

    expect(mapped.length).toBe(1);
    expect(mapped[0]).toBe(64);

    networkInput.close();
    networkOutput.close();
  });

  it('multiple CCs maintain state through engine across network', async () => {
    const p = nextPort();
    const server = new TcpServer();
    server.start(p);
    const networkOutput = new TcpBroadcastOutputAdapter(server);

    const client = new TcpClient();
    const browser = createMockBrowser('127.0.0.1', p);
    const networkInput = new TcpClientInputAdapter(client, browser);

    const config: AppConfig = {
      deviceName: 'Test',
      mode: 'local',
      rules: [
        {
          cc: 11,
          label: 'Smoothed',
          inputMin: 0,
          inputMax: 127,
          outputMin: 0,
          outputMax: 127,
          curve: 'linear',
          smoothing: 3,
        },
      ],
    };
    const rules = buildRules(config);

    const mapped: number[] = [];
    let engineState = INITIAL_ENGINE_STATE;

    networkInput.onMessage((msg) => {
      const { result, nextState } = processMidiMessage(msg, rules, {}, engineState);
      engineState = nextState;
      mapped.push(result.log.mappedValue);
    });

    networkInput.open(0);
    await new Promise((r) => setTimeout(r, 100));

    // Send 3 values for smoothing
    networkOutput.send([0xb0, 11, 60]);
    networkOutput.send([0xb0, 11, 90]);
    networkOutput.send([0xb0, 11, 120]);
    await new Promise((r) => setTimeout(r, 200));

    expect(mapped.length).toBe(3);
    // Smoothing window 3: avg(60)=60, avg(60,90)=75, avg(60,90,120)=90
    expect(mapped[0]).toBe(60);
    expect(mapped[1]).toBe(75);
    expect(mapped[2]).toBe(90);

    networkInput.close();
    networkOutput.close();
  });

  it('network config loads from YAML and applies', async () => {
    // Test that config.yaml with network section parses correctly
    // and the values can be used to start a TCP server
    const { parseConfig } = await import('../../src/adapters/yaml-config.adapter');

    const yaml = `
deviceName: "Test"
mode: local
rules:
  - cc: 1
    label: "X"
    inputMin: 0
    inputMax: 127
    outputMin: 0
    outputMax: 127
    curve: linear
network:
  port: 9999
  pin: "4567"
  hostName: "My Studio"
`;
    const config = parseConfig(yaml);
    expect(config.network).toBeDefined();
    expect(config.network!.port).toBe(9999);
    expect(config.network!.pin).toBe('4567');
    expect(config.network!.hostName).toBe('My Studio');

    // Use the config to start a real TCP server
    const p = config.network!.port!;
    const server = new TcpServer(config.network!.pin);
    server.start(p);

    // Verify PIN works
    const client = new TcpClient();
    const connected = await client.connect('127.0.0.1', p, '4567');
    expect(connected).toBe(true);

    client.disconnect();
    server.stop();
  });
});
