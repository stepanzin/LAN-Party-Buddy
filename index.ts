import { parseArgs } from 'util';
import { resolve, dirname } from 'node:path';

import { MidiMapperApp } from './src/app/midi-mapper.app';
import { YamlConfigAdapter } from './src/adapters/yaml-config.adapter';
import { JsonStateAdapter } from './src/adapters/json-state.adapter';
import { JulusianMidiInputAdapter, JulusianMidiOutputAdapter, JulusianDeviceDiscoveryAdapter } from './src/adapters/julusian-midi.adapter';
import { InquirerCliAdapter } from './src/adapters/inquirer-cli.adapter';

const { values: args } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    config: { type: 'string', short: 'c' },
  },
});

function resolveConfigPath(explicit?: string): string {
  if (explicit) return resolve(explicit);

  // Check CWD first, then next to the executable
  const candidates = [
    resolve('config.yaml'),
    resolve(dirname(Bun.argv[0]!), 'config.yaml'),
  ];

  for (const path of candidates) {
    if (Bun.file(path).size > 0) return path;
  }

  console.error(
    'Config file not found. Searched:\n' +
    candidates.map(p => `  - ${p}`).join('\n') +
    '\n\nUsage: midi-mapper --config <path/to/config.yaml>',
  );
  process.exit(1);
}

const configPath = resolveConfigPath(args.config);

const app = new MidiMapperApp({
  configReader: new YamlConfigAdapter(),
  stateStore: new JsonStateAdapter(),
  midiInput: new JulusianMidiInputAdapter(),
  midiOutput: new JulusianMidiOutputAdapter(),
  deviceDiscovery: new JulusianDeviceDiscoveryAdapter(),
  ui: new InquirerCliAdapter(),
});

process.on('SIGINT', () => {
  console.log('\nShutting down MIDI mapper...');
  process.exit(0);
});
process.on('SIGTERM', () => {
  console.log('\nShutting down MIDI mapper...');
  process.exit(0);
});

process.stdin.resume();
await app.run(configPath);
