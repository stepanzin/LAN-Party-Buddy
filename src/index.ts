import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { InkTuiAdapter } from '@adapters/ink-tui/ink-tui.adapter';
import { TuiStore } from '@adapters/ink-tui/tui-store';
import { JsonStateAdapter } from '@adapters/json-state.adapter';
import {
  JulusianDeviceDiscoveryAdapter,
  JulusianMidiInputAdapter,
  JulusianMidiOutputAdapter,
} from '@adapters/julusian-midi.adapter';
import { MdnsAdvertiserAdapter } from '@adapters/network/mdns-advertiser.adapter';
import { MdnsBrowserDiscoveryAdapter } from '@adapters/network/mdns-browser-discovery.adapter';
import { StaticDeviceDiscoveryAdapter } from '@adapters/network/static-device-discovery.adapter';
import { TcpBroadcastOutputAdapter } from '@adapters/network/tcp-broadcast-output.adapter';
import { TcpClient } from '@adapters/network/tcp-client';
import { TcpClientInputAdapter } from '@adapters/network/tcp-client-input.adapter';
// Network adapters
import { TcpServer } from '@adapters/network/tcp-server';
import { VirtualPortInputAdapter } from '@adapters/network/virtual-port-input.adapter';
import { YamlConfigAdapter, YamlConfigWriterAdapter } from '@adapters/yaml-config.adapter';
import { ConfigEditorService } from '@app/config-editor.service';
import { MidiMapperApp } from '@app/midi-mapper.app';
import type { AppMode } from '@domain/config';
import type { DeviceDiscoveryPort } from '@ports/device-discovery.port';
import type { MidiInputPort } from '@ports/midi-input.port';
import type { MidiOutputPort } from '@ports/midi-output.port';

const { values: args } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    config: { type: 'string', short: 'c' },
  },
});

function findConfigPath(explicit?: string): { path: string; exists: boolean } {
  if (explicit) return { path: resolve(explicit), exists: true };
  const argv0 = Bun.argv[0] ?? '.';
  for (const p of [resolve('config.yaml'), resolve(dirname(argv0), 'config.yaml')]) {
    try {
      if (Bun.file(p).size > 0) return { path: p, exists: true };
    } catch {}
  }
  return { path: resolve(dirname(argv0), 'config.yaml'), exists: false };
}

const { path: configPath, exists: configExists } = findConfigPath(args.config);
const configWriter = new YamlConfigWriterAdapter();
const store = new TuiStore();
const tuiAdapter = new InkTuiAdapter(store);

// If config doesn't exist, show welcome screen to pick mode, then create config
if (!configExists) {
  const selectedMode: AppMode = await tuiAdapter.showWelcome();
  await configWriter.save(configPath, { deviceName: 'LAN Party Buddy Output', mode: selectedMode, rules: [] });
}

// Load config (always exists now)
const configReader = new YamlConfigAdapter();
const config = await configReader.load(configPath);

const mode = config.mode;

store.setConfig(config);
store.setMode(mode);

const editorService = new ConfigEditorService(config, configWriter);
editorService.onConfigChanged = (c) => store.setConfig(c);

// Re-create tuiAdapter with configEditor
const tuiAdapterFull = new InkTuiAdapter(store, editorService);

// Wire adapters based on mode
let midiInput: MidiInputPort;
let midiOutput: MidiOutputPort;
let deviceDiscovery: DeviceDiscoveryPort;
let cleanupNetwork = () => {};

const DEFAULT_PORT = 9900;

if (mode === 'host') {
  const tcpServer = new TcpServer();
  tcpServer.start(DEFAULT_PORT);
  tcpServer.on('clientConnected', (id: string, address: string) => {
    store.addClient({ id, address });
  });
  tcpServer.on('clientDisconnected', (id: string) => {
    store.removeClient(id);
  });

  const advertiser = new MdnsAdvertiserAdapter();
  advertiser.advertise(DEFAULT_PORT, 'MIDI Mapper', false);

  store.setHostInfo(DEFAULT_PORT, null, 'open');

  midiInput = new VirtualPortInputAdapter('MIDI Mapper Input');
  midiOutput = new TcpBroadcastOutputAdapter(tcpServer);
  deviceDiscovery = new StaticDeviceDiscoveryAdapter('Virtual Port (Host Mode)');

  cleanupNetwork = () => {
    tcpServer.stop();
    advertiser.destroy();
  };
} else if (mode === 'join') {
  const browser = new MdnsBrowserDiscoveryAdapter();
  browser.startBrowsing();

  const tcpClient = new TcpClient();
  tcpClient.on('connected', () => {
    store.setConnectionStatus(true);
  });
  tcpClient.on('disconnected', () => {
    store.setConnectionStatus(false);
    store.setConnectedHost(null);
  });

  midiInput = new TcpClientInputAdapter(tcpClient, browser);
  midiOutput = new JulusianMidiOutputAdapter();
  deviceDiscovery = browser;

  cleanupNetwork = () => {
    tcpClient.disconnect();
    browser.destroy();
  };
} else {
  // Local mode
  midiInput = new JulusianMidiInputAdapter();
  midiOutput = new JulusianMidiOutputAdapter();
  deviceDiscovery = new JulusianDeviceDiscoveryAdapter();
}

const stateStore = new JsonStateAdapter();

const app = new MidiMapperApp(
  {
    midiInput,
    midiOutput,
    deviceDiscovery,
    ui: tuiAdapterFull,
    configReader,
    configWriter,
    stateStore,
    monitor: tuiAdapterFull,
    configEditor: editorService,
  },
  2000,
);

app.setConfigEditorService(editorService);

process.on('SIGINT', () => {
  cleanupNetwork();
  tuiAdapterFull.stop();
  process.exit(0);
});
process.on('SIGTERM', () => {
  cleanupNetwork();
  tuiAdapterFull.stop();
  process.exit(0);
});

app.run(configPath);
await tuiAdapterFull.waitForExit();
cleanupNetwork();
