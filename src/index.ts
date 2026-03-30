import { parseArgs } from 'util';
import { resolve, dirname } from 'node:path';

import { MidiMapperApp } from './app/midi-mapper.app';
import { YamlConfigAdapter, YamlConfigWriterAdapter } from './adapters/yaml-config.adapter';
import { JsonStateAdapter } from './adapters/json-state.adapter';
import { JulusianMidiInputAdapter, JulusianMidiOutputAdapter, JulusianDeviceDiscoveryAdapter } from './adapters/julusian-midi.adapter';
import { InkTuiAdapter } from './adapters/ink-tui/ink-tui.adapter';
import { TuiStore } from './adapters/ink-tui/tui-store';
import { ConfigEditorService } from './app/config-editor.service';
import type { MidiInputPort } from './ports/midi-input.port';
import type { MidiOutputPort } from './ports/midi-output.port';
import type { DeviceDiscoveryPort } from './ports/device-discovery.port';
import type { WelcomeChoice } from './ports/user-interface.port';

// Network adapters
import { TcpServer } from './adapters/network/tcp-server';
import { TcpClient } from './adapters/network/tcp-client';
import { TcpBroadcastOutputAdapter } from './adapters/network/tcp-broadcast-output.adapter';
import { TcpClientInputAdapter } from './adapters/network/tcp-client-input.adapter';
import { VirtualPortInputAdapter } from './adapters/network/virtual-port-input.adapter';
import { StaticDeviceDiscoveryAdapter } from './adapters/network/static-device-discovery.adapter';
import { MdnsAdvertiserAdapter } from './adapters/network/mdns-advertiser.adapter';
import { MdnsBrowserDiscoveryAdapter } from './adapters/network/mdns-browser-discovery.adapter';

const { values: args } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    config: { type: 'string', short: 'c' },
    mode: { type: 'string', short: 'm' },
  },
});

function findConfigPath(explicit?: string): { path: string; exists: boolean } {
  if (explicit) return { path: resolve(explicit), exists: true };
  for (const p of [resolve('config.yaml'), resolve(dirname(Bun.argv[0]!), 'config.yaml')]) {
    try { if (Bun.file(p).size > 0) return { path: p, exists: true }; } catch {}
  }
  return { path: resolve(dirname(Bun.argv[0]!), 'config.yaml'), exists: false };
}

const { path: configPath, exists: configExists } = findConfigPath(args.config);
const configWriter = new YamlConfigWriterAdapter();
const store = new TuiStore();
const editorService = new ConfigEditorService(
  { deviceName: 'LAN Party Buddy Output', rules: [] },
  configWriter,
);
editorService.onConfigChanged = (c) => store.setConfig(c);
const tuiAdapter = new InkTuiAdapter(store, editorService);

// Load state to check for saved mode
const stateStore = new JsonStateAdapter();
const savedState = await stateStore.load();

// Determine mode: CLI arg > saved mode > welcome screen > local default
let mode: WelcomeChoice;
if (args.mode && ['local', 'host', 'join'].includes(args.mode)) {
  mode = args.mode as WelcomeChoice;
} else if (savedState.lastMode) {
  mode = savedState.lastMode;
} else if (!configExists) {
  mode = await tuiAdapter.showWelcome();
} else {
  mode = 'local'; // default for existing config
}

// Save selected mode to state
await stateStore.save({ ...savedState, lastMode: mode });

store.setMode(mode);

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
  advertiser.advertise(DEFAULT_PORT, 'LAN Party Buddy', false);

  store.setHostInfo(DEFAULT_PORT, null, 'open');

  midiInput = new VirtualPortInputAdapter('LAN Party Buddy Input');
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

const app = new MidiMapperApp({
  midiInput,
  midiOutput,
  deviceDiscovery,
  ui: tuiAdapter,
  configReader: new YamlConfigAdapter(),
  configWriter,
  stateStore: new JsonStateAdapter(),
  monitor: tuiAdapter,
  configEditor: editorService,
}, 2000);

app.setConfigEditorService(editorService);

process.on('SIGINT', () => {
  cleanupNetwork();
  tuiAdapter.stop();
  process.exit(0);
});
process.on('SIGTERM', () => {
  cleanupNetwork();
  tuiAdapter.stop();
  process.exit(0);
});

app.run(configPath, configExists);
await tuiAdapter.waitForExit();
cleanupNetwork();
