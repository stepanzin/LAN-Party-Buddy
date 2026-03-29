import { parseArgs } from 'util';
import { resolve, dirname } from 'node:path';

import { MidiMapperApp } from './app/midi-mapper.app';
import { YamlConfigAdapter, YamlConfigWriterAdapter } from './adapters/yaml-config.adapter';
import { JsonStateAdapter } from './adapters/json-state.adapter';
import { JulusianMidiInputAdapter, JulusianMidiOutputAdapter, JulusianDeviceDiscoveryAdapter } from './adapters/julusian-midi.adapter';
import { InkTuiAdapter } from './adapters/ink-tui/ink-tui.adapter';
import { TuiStore } from './adapters/ink-tui/tui-store';
import { ConfigEditorService } from './app/config-editor.service';

const { values: args } = parseArgs({
  args: Bun.argv.slice(2),
  options: { config: { type: 'string', short: 'c' } },
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
  { deviceName: 'MIDI Mapper Output', rules: [] },
  configWriter,
);
editorService.onConfigChanged = (c) => store.setConfig(c);

const tuiAdapter = new InkTuiAdapter(store, editorService);

const app = new MidiMapperApp({
  midiInput: new JulusianMidiInputAdapter(),
  midiOutput: new JulusianMidiOutputAdapter(),
  deviceDiscovery: new JulusianDeviceDiscoveryAdapter(),
  ui: tuiAdapter,
  configReader: new YamlConfigAdapter(),
  configWriter,
  stateStore: new JsonStateAdapter(),
  monitor: tuiAdapter,
  configEditor: editorService,
}, 2000);

app.setConfigEditorService(editorService);

process.on('SIGINT', () => { tuiAdapter.stop(); process.exit(0); });
process.on('SIGTERM', () => { tuiAdapter.stop(); process.exit(0); });

app.run(configPath, configExists);
await tuiAdapter.waitForExit();
