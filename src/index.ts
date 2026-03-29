import { parseArgs } from 'util';
import { resolve, dirname } from 'node:path';
import { stringify as yamlStringify } from 'yaml';

import { MidiMapperApp } from './app/midi-mapper.app';
import { YamlConfigAdapter, YamlConfigWriterAdapter } from './adapters/yaml-config.adapter';
import { JsonStateAdapter } from './adapters/json-state.adapter';
import { JulusianMidiInputAdapter, JulusianMidiOutputAdapter, JulusianDeviceDiscoveryAdapter } from './adapters/julusian-midi.adapter';
import { InkTuiAdapter } from './adapters/ink-tui/ink-tui.adapter';
import { TuiStore } from './adapters/ink-tui/tui-store';
import { ConfigEditorService } from './app/config-editor.service';
import type { AppConfig } from './domain/config';

const { values: args } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    config: { type: 'string', short: 'c' },
  },
});

const DEFAULT_CONFIG: AppConfig = {
  deviceName: 'MIDI Mapper Output',
  rules: [],
};

function resolveConfigPath(explicit?: string): string {
  if (explicit) return resolve(explicit);

  // Search: CWD → next to binary → home dir
  const candidates = [
    resolve('config.yaml'),
    resolve(dirname(Bun.argv[0]!), 'config.yaml'),
  ];

  for (const path of candidates) {
    try {
      if (Bun.file(path).size > 0) return path;
    } catch {}
  }

  // Not found — generate empty config next to the binary/script
  const newPath = resolve(dirname(Bun.argv[0]!), 'config.yaml');
  Bun.write(newPath, yamlStringify(DEFAULT_CONFIG));
  return newPath;
}

const configPath = resolveConfigPath(args.config);

const configAdapter = new YamlConfigAdapter();
const config = await configAdapter.load(configPath);
const configWriter = new YamlConfigWriterAdapter();

const store = new TuiStore();
store.setConfig(config);

const editorService = new ConfigEditorService(config, configWriter);
editorService.onConfigChanged = (newConfig) => {
  store.setConfig(newConfig);
};

const tuiAdapter = new InkTuiAdapter(store, editorService);

const app = new MidiMapperApp({
  configReader: configAdapter,
  stateStore: new JsonStateAdapter(),
  midiInput: new JulusianMidiInputAdapter(),
  midiOutput: new JulusianMidiOutputAdapter(),
  deviceDiscovery: new JulusianDeviceDiscoveryAdapter(),
  ui: tuiAdapter,
  monitor: tuiAdapter,
  configEditor: editorService,
}, 2000);

app.setConfigEditorService(editorService);

process.on('SIGINT', () => {
  tuiAdapter.stop();
  process.exit(0);
});
process.on('SIGTERM', () => {
  tuiAdapter.stop();
  process.exit(0);
});

tuiAdapter.start();
app.run(configPath);
await tuiAdapter.waitForExit();
