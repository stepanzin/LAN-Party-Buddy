import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InkTuiAdapter } from '@adapters/ink-tui/ink-tui.adapter';
import { TuiStore } from '@adapters/ink-tui/tui-store';
import { JsonStateAdapter } from '@adapters/json-state.adapter';
import { YamlConfigAdapter, YamlConfigWriterAdapter } from '@adapters/yaml-config.adapter';
import { ConfigEditorService } from '@app/config-editor.service';
import { MidiMapperApp } from '@app/midi-mapper.app';
import type { DeviceDiscoveryPort, MidiDevice } from '@ports/device-discovery.port';
import type { MidiErrorHandler, MidiInputPort, MidiMessageHandler } from '@ports/midi-input.port';
import type { MidiOutputPort } from '@ports/midi-output.port';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEVICES: MidiDevice[] = [
  { index: 0, name: 'Controller A' },
  { index: 1, name: 'Controller B' },
];

const TEST_CONFIG_YAML = `
deviceName: "Test TUI Output"
mode: local
rules:
  - cc: 4
    label: "Expression"
    inputMin: 0
    inputMax: 127
    outputMin: 0
    outputMax: 127
    curve: linear
  - cc: 64
    label: "Sustain Toggle"
    inputMin: 0
    inputMax: 127
    outputMin: 0
    outputMax: 127
    curve: linear
    mode: toggle
macros:
  - input: 1
    label: "Macro"
    outputs:
      - cc: 74
        label: "Filter"
        outputMin: 0
        outputMax: 127
        curve: linear
`;

function createMockMidiInput() {
  let messageHandler: MidiMessageHandler | null = null;
  const input: MidiInputPort = {
    open: mock((_idx: number) => {}),
    close: mock(() => {}),
    onMessage: mock((handler: MidiMessageHandler) => {
      messageHandler = handler;
    }),
    onError: mock((_handler: MidiErrorHandler) => {}),
  };
  return {
    input,
    simulateMessage(msg: { channel: number; cc: number; value: number }) {
      messageHandler?.(msg);
    },
  };
}

function createMockMidiOutput() {
  const sentMessages: Array<readonly [number, number, number]> = [];
  const port: MidiOutputPort = {
    openVirtual: mock((_name: string) => {}),
    send: mock((msg: readonly [number, number, number]) => {
      sentMessages.push(msg);
    }),
    close: mock(() => {}),
  };
  return { port, sentMessages };
}

function createMockDeviceDiscovery(devicesSequence: MidiDevice[][], connectionChecks: boolean[]): DeviceDiscoveryPort {
  let listCount = 0;
  let connCount = 0;
  return {
    listDevices: mock(() => {
      const d = devicesSequence[Math.min(listCount, devicesSequence.length - 1)]!;
      listCount++;
      return d;
    }),
    isDeviceConnected: mock((_name: string) => {
      const c = connectionChecks[Math.min(connCount, connectionChecks.length - 1)]!;
      connCount++;
      return c;
    }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('E2E: TUI Flow (InkTuiAdapter + TuiStore + Monitor + ConfigEditor)', () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'midi-mapper-tui-e2e-'));
    configPath = join(tmpDir, 'config.yaml');
    await Bun.write(configPath, TEST_CONFIG_YAML);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  async function buildTuiApp(opts: {
    devicesSequence: MidiDevice[][];
    connectionChecks: boolean[];
    autoResolveDevice?: boolean;
  }) {
    const store = new TuiStore();
    const mockInput = createMockMidiInput();
    const mockOutput = createMockMidiOutput();
    const discovery = createMockDeviceDiscovery(opts.devicesSequence, opts.connectionChecks);

    const configAdapter = new YamlConfigAdapter();
    const configWriter = new YamlConfigWriterAdapter();
    const stateAdapter = new JsonStateAdapter(join(tmpDir, 'state.json'));

    // Load real config so editor service has correct initial state
    const config = await configAdapter.load(configPath);
    store.setConfig(config);

    const editorService = new ConfigEditorService(config, configWriter);
    editorService.onConfigChanged = (newConfig) => {
      store.setConfig(newConfig);
    };

    const tuiAdapter = new InkTuiAdapter(store, editorService);

    // Auto-resolve device selection unless disabled
    if (opts.autoResolveDevice !== false) {
      store.on('change', () => {
        const s = store.getState();
        if (s.deviceSelectionDevices && s.deviceSelectionResolver) {
          setTimeout(() => store.resolveDeviceSelection(0), 1);
        }
      });
    }

    const app = new MidiMapperApp(
      {
        midiInput: mockInput.input,
        midiOutput: mockOutput.port,
        deviceDiscovery: discovery,
        ui: tuiAdapter,
        configReader: configAdapter,
        configWriter,
        stateStore: stateAdapter,
        monitor: tuiAdapter,
        configEditor: editorService,
      },
      10,
    );

    app.setConfigEditorService(editorService);

    return { app, store, mockInput, mockOutput, editorService, stateAdapter, tuiAdapter };
  }

  // -----------------------------------------------------------------------
  // System message on no devices
  // -----------------------------------------------------------------------

  it('shows system error in store when no MIDI devices found', async () => {
    const { app, store } = await buildTuiApp({
      devicesSequence: [[]], // no devices
      connectionChecks: [],
    });

    await app.run(configPath);

    expect(store.getState().systemMessage).toBe('No MIDI input devices found. Connect a device and try again.');
  });

  it('store remains accessible after app.run returns (process stays alive scenario)', async () => {
    const { app, store } = await buildTuiApp({
      devicesSequence: [[]],
      connectionChecks: [],
    });

    await app.run(configPath);

    // Store is still functional after app exits
    store.setTab('editor');
    expect(store.getState().tab).toBe('editor');
    store.setTab('log');
    expect(store.getState().tab).toBe('log');
  });

  // -----------------------------------------------------------------------
  // Monitor: real-time data in store
  // -----------------------------------------------------------------------

  it('pushes MIDI activity to store on matched rule', async () => {
    const { app, store, mockInput } = await buildTuiApp({
      devicesSequence: [DEVICES, []],
      connectionChecks: [false],
    });

    await app.run(configPath);
    mockInput.simulateMessage({ channel: 0, cc: 4, value: 80 });

    const state = store.getState();
    expect(state.activities.length).toBe(1);
    expect(state.activities[0]!.cc).toBe(4);
    expect(state.activities[0]!.value).toBe(80);
    expect(state.activities[0]!.mappedValue).toBe(80);
    expect(state.activities[0]!.ruleLabel).toBe('Expression');
  });

  it('pushes unmapped CC to store when no rule matches', async () => {
    const { app, store, mockInput } = await buildTuiApp({
      devicesSequence: [DEVICES, []],
      connectionChecks: [false],
    });

    await app.run(configPath);
    mockInput.simulateMessage({ channel: 0, cc: 99, value: 42 });

    const state = store.getState();
    expect(state.unmapped.size).toBe(1);
    expect(state.unmapped.get(99)!.value).toBe(42);
  });

  it('pushes macro activity to store', async () => {
    const { app, store, mockInput } = await buildTuiApp({
      devicesSequence: [DEVICES, []],
      connectionChecks: [false],
    });

    await app.run(configPath);
    mockInput.simulateMessage({ channel: 0, cc: 1, value: 100 });

    const state = store.getState();
    expect(state.macroActivities.length).toBe(1);
    expect(state.macroActivities[0]!.inputCc).toBe(1);
    expect(state.macroActivities[0]!.outputs).toEqual([{ cc: 74, value: 100 }]);
  });

  it('sets device name in store after connection', async () => {
    const { app, store } = await buildTuiApp({
      devicesSequence: [DEVICES, []],
      connectionChecks: [false],
    });

    await app.run(configPath);

    expect(store.getState().device).toBe('Controller A');
  });

  it('sets connection status to false on disconnect', async () => {
    const { app, store } = await buildTuiApp({
      devicesSequence: [DEVICES, []],
      connectionChecks: [true, false], // connected, then disconnect
    });

    await app.run(configPath);

    // After disconnect, connected should be false
    expect(store.getState().connected).toBe(false);
  });

  // -----------------------------------------------------------------------
  // Log entries
  // -----------------------------------------------------------------------

  it('pushes matched messages to log entries', async () => {
    const { app, store, mockInput } = await buildTuiApp({
      devicesSequence: [DEVICES, []],
      connectionChecks: [false],
    });

    await app.run(configPath);
    mockInput.simulateMessage({ channel: 0, cc: 4, value: 64 });

    const logs = store.getState().logEntries;
    expect(logs.length).toBe(1);
    expect(logs[0]!.cc).toBe(4);
    expect(logs[0]!.matched).toBe(true);
    expect(logs[0]!.ruleLabel).toBe('Expression');
  });

  it('pushes unmapped messages to log as unmatched', async () => {
    const { app, store, mockInput } = await buildTuiApp({
      devicesSequence: [DEVICES, []],
      connectionChecks: [false],
    });

    await app.run(configPath);
    mockInput.simulateMessage({ channel: 0, cc: 55, value: 10 });

    const logs = store.getState().logEntries;
    expect(logs.length).toBe(1);
    expect(logs[0]!.matched).toBe(false);
  });

  // -----------------------------------------------------------------------
  // MIDI Learn via ConfigEditorService
  // -----------------------------------------------------------------------

  it('MIDI learn captures CC and skips normal processing', async () => {
    const { app, store, mockInput, mockOutput, editorService } = await buildTuiApp({
      devicesSequence: [DEVICES, []],
      connectionChecks: [false],
    });

    await app.run(configPath);

    // Start MIDI learn
    const learnPromise = editorService.startMidiLearn();

    // Send a MIDI message — should be intercepted, not processed
    const sentBefore = mockOutput.sentMessages.length;
    mockInput.simulateMessage({ channel: 0, cc: 74, value: 127 });

    // No new messages sent (learn intercepted it)
    expect(mockOutput.sentMessages.length).toBe(sentBefore);

    // Learn should resolve with the CC number
    const learned = await learnPromise;
    expect(learned).toBe(74);

    // Normal processing resumes
    mockInput.simulateMessage({ channel: 0, cc: 4, value: 50 });
    expect(mockOutput.sentMessages.length).toBeGreaterThan(sentBefore);
  });

  // -----------------------------------------------------------------------
  // Hot-reload via ConfigEditorService
  // -----------------------------------------------------------------------

  it('hot-reload: updated rules take effect for next message', async () => {
    const { app, store, mockInput, mockOutput, editorService } = await buildTuiApp({
      devicesSequence: [DEVICES, []],
      connectionChecks: [false],
    });

    await app.run(configPath);

    // CC 4 currently maps linear 0-127 → 0-127
    mockInput.simulateMessage({ channel: 0, cc: 4, value: 100 });
    const cc4Before = mockOutput.sentMessages.filter((m) => m[1] === 4);
    expect(cc4Before[0]![2]).toBe(100);

    // Update rule: invert CC 4
    const currentConfig = editorService.getConfig();
    const updatedRule = { ...currentConfig.rules[0]!, invert: true };
    editorService.updateRule(0, updatedRule);

    // Now CC 4 should be inverted: value 100 → 127 - 100 = 27 (approximately)
    mockInput.simulateMessage({ channel: 0, cc: 4, value: 100 });
    const cc4After = mockOutput.sentMessages.filter((m) => m[1] === 4);
    // Inverted: inputMin=0, inputMax=127, outputMin/Max swapped → 127→0 mapping
    // value 100 with inverted → round((127-100)/127 * 127) ≈ 27
    expect(cc4After[1]![2]).not.toBe(100); // different from before
  });

  it('hot-reload: store config updates on rule change', async () => {
    const { app, store, editorService } = await buildTuiApp({
      devicesSequence: [DEVICES, []],
      connectionChecks: [false],
    });

    await app.run(configPath);

    const configBefore = store.getState().config;
    expect(configBefore?.rules[0]?.label).toBe('Expression');

    // Update label
    const rule = editorService.getConfig().rules[0]!;
    editorService.updateRule(0, { ...rule, label: 'New Label' });

    const configAfter = store.getState().config;
    expect(configAfter?.rules[0]?.label).toBe('New Label');
  });

  // -----------------------------------------------------------------------
  // Config save
  // -----------------------------------------------------------------------

  it('saves modified config to YAML file', async () => {
    const { app, editorService } = await buildTuiApp({
      devicesSequence: [DEVICES, []],
      connectionChecks: [false],
    });

    await app.run(configPath);

    // Modify and save
    const rule = editorService.getConfig().rules[0]!;
    editorService.updateRule(0, { ...rule, label: 'Saved Expression' });
    await editorService.saveConfig(join(tmpDir, 'saved-config.yaml'));

    // Load back and verify
    const reloaded = await new YamlConfigAdapter().load(join(tmpDir, 'saved-config.yaml'));
    expect(reloaded.rules[0]!.label).toBe('Saved Expression');
  });

  // -----------------------------------------------------------------------
  // Device selection via store
  // -----------------------------------------------------------------------

  it('device selection works through store resolver (TUI select flow)', async () => {
    const { app, store } = await buildTuiApp({
      devicesSequence: [DEVICES, []],
      connectionChecks: [false],
      autoResolveDevice: false,
    });

    // Simulate user selecting Controller B (index 1) on next store change
    store.on('change', () => {
      const s = store.getState();
      if (s.deviceSelectionDevices && s.deviceSelectionResolver) {
        setTimeout(() => store.resolveDeviceSelection(1), 1);
      }
    });

    await app.run(configPath);

    expect(store.getState().device).toBe('Controller B');
  });

  // -----------------------------------------------------------------------
  // Multiple messages build up monitor state
  // -----------------------------------------------------------------------

  it('multiple messages accumulate in store activities', async () => {
    const { app, store, mockInput } = await buildTuiApp({
      devicesSequence: [DEVICES, []],
      connectionChecks: [false],
    });

    await app.run(configPath);

    for (let i = 0; i < 10; i++) {
      mockInput.simulateMessage({ channel: 0, cc: 4, value: i * 12 });
    }

    expect(store.getState().activities.length).toBe(10);
    expect(store.getState().messageCount).toBe(10);
    expect(store.getState().logEntries.length).toBe(10);
  });
});
