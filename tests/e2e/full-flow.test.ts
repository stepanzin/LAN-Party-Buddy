import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { join } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

import { MidiMapperApp, type MidiMapperDeps } from '../../src/app/midi-mapper.app.ts';
import { YamlConfigAdapter } from '../../src/adapters/yaml-config.adapter.ts';
import { JsonStateAdapter } from '../../src/adapters/json-state.adapter.ts';
import type { MidiInputPort, MidiMessageHandler, MidiErrorHandler } from '../../src/ports/midi-input.port.ts';
import type { MidiOutputPort } from '../../src/ports/midi-output.port.ts';
import type { DeviceDiscoveryPort, MidiDevice } from '../../src/ports/device-discovery.port.ts';
import type { UserInterfacePort } from '../../src/ports/user-interface.port.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEVICES: MidiDevice[] = [
  { index: 0, name: 'Controller A' },
  { index: 1, name: 'Controller B' },
];

function createMockMidiInput() {
  let messageHandler: MidiMessageHandler | null = null;
  let errorHandler: MidiErrorHandler | null = null;
  const input: MidiInputPort = {
    open: mock((_idx: number) => {}),
    close: mock(() => {}),
    onMessage: mock((handler: MidiMessageHandler) => { messageHandler = handler; }),
    onError: mock((handler: MidiErrorHandler) => { errorHandler = handler; }),
  };
  return {
    input,
    simulateMessage(msg: { channel: number; cc: number; value: number }) {
      messageHandler?.(msg);
    },
    simulateError(err: Error) {
      errorHandler?.(err);
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

function createMockDeviceDiscovery(
  devicesSequence: MidiDevice[][],
  connectionChecks: boolean[],
): DeviceDiscoveryPort {
  let listCallCount = 0;
  let connCheckCount = 0;
  return {
    listDevices: mock(() => {
      const devices = devicesSequence[Math.min(listCallCount, devicesSequence.length - 1)]!;
      listCallCount++;
      return devices;
    }),
    isDeviceConnected: mock((_name: string) => {
      const connected = connectionChecks[Math.min(connCheckCount, connectionChecks.length - 1)]!;
      connCheckCount++;
      return connected;
    }),
  };
}

function createMockUI(selectedDeviceIndex = 0) {
  const messages: string[] = [];
  const mappingLogs: Array<{ cc: number; original: number; mapped: number }> = [];
  const port: UserInterfacePort = {
    start: mock(() => {}),
    stop: mock(() => {}),
    waitForExit: mock(() => Promise.resolve()),
    showWelcome: mock(() => Promise.resolve('mapper' as const)),
    selectDevice: mock((_devices: MidiDevice[]) => Promise.resolve(selectedDeviceIndex)),
    showInfo: mock((msg: string) => { messages.push(`[INFO] ${msg}`); }),
    showWarning: mock((msg: string) => { messages.push(`[WARN] ${msg}`); }),
    showError: mock((msg: string) => { messages.push(`[ERROR] ${msg}`); }),
    logMapping: mock((cc: number, orig: number, mapped: number) => {
      mappingLogs.push({ cc, original: orig, mapped });
    }),
  };
  return { port, messages, mappingLogs };
}

const TEST_CONFIG_YAML = `
deviceName: "Test MIDI Output"
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
  - cc: 11
    label: "Smoothed"
    inputMin: 0
    inputMax: 127
    outputMin: 0
    outputMax: 127
    curve: linear
    smoothing: 3
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('E2E: Full Application Flow', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'midi-mapper-e2e-'));
    await Bun.write(join(tmpDir, 'test-config.yaml'), TEST_CONFIG_YAML);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  function buildApp(opts: {
    devicesSequence: MidiDevice[][];
    connectionChecks: boolean[];
    selectedDeviceIndex?: number;
    statePath?: string;
  }) {
    const mockInput = createMockMidiInput();
    const mockOutput = createMockMidiOutput();
    const discovery = createMockDeviceDiscovery(opts.devicesSequence, opts.connectionChecks);
    const ui = createMockUI(opts.selectedDeviceIndex ?? 0);
    const configAdapter = new YamlConfigAdapter();
    const stateAdapter = new JsonStateAdapter(opts.statePath ?? join(tmpDir, 'state.json'));

    const mockConfigWriter = { save: mock(() => Promise.resolve()) };

    const deps: MidiMapperDeps = {
      midiInput: mockInput.input,
      midiOutput: mockOutput.port,
      deviceDiscovery: discovery,
      ui: ui.port,
      configReader: configAdapter,
      configWriter: mockConfigWriter,
      stateStore: stateAdapter,
    };

    const app = new MidiMapperApp(deps, 10);
    return { app, mockInput, mockOutput, discovery, ui, stateAdapter, configPath: join(tmpDir, 'test-config.yaml') };
  }

  // -----------------------------------------------------------------------

  it('full flow: load config -> auto-connect -> process messages -> disconnect', async () => {
    // Pre-save state with lastDevice so it auto-connects
    const statePath = join(tmpDir, 'state.json');
    await Bun.write(statePath, JSON.stringify({ lastDevice: 'Controller A' }));

    const { app, mockInput, mockOutput, ui, stateAdapter, configPath } = buildApp({
      devicesSequence: [DEVICES, []], // first: devices, second: empty -> exit
      connectionChecks: [true, true, false], // poll twice connected, then disconnect
      statePath,
    });

    const runPromise = app.run(configPath, true);

    // Wait for the app to wire up message handler and disconnect
    await runPromise;

    // Verify auto-connect info was shown (no selectDevice call)
    expect(ui.port.selectDevice).not.toHaveBeenCalled();
    expect(ui.port.showInfo).toHaveBeenCalledWith('Auto-connecting to last device: Controller A');

    // Inject MIDI messages through the captured handler
    mockInput.simulateMessage({ channel: 0, cc: 4, value: 64 });
    mockInput.simulateMessage({ channel: 0, cc: 4, value: 127 });

    // Verify output was sent (NRPN preamble + main message per input)
    expect(mockOutput.sentMessages.length).toBeGreaterThanOrEqual(6); // 3 per message * 2

    // Verify CC4 value=64 mapped linearly: output should be 64
    // Each message produces: [0xb0, 99, 127], [0xb0, 100, 0], [0xb0, 4, mappedValue]
    const cc4Outputs = mockOutput.sentMessages.filter(m => m[1] === 4);
    expect(cc4Outputs[0]).toEqual([0xb0, 4, 64]);
    expect(cc4Outputs[1]).toEqual([0xb0, 4, 127]);

    // Verify disconnect warning
    expect(ui.port.showWarning).toHaveBeenCalledWith('Device "Controller A" disconnected.');

    // Verify state was saved with device name
    const savedState = await stateAdapter.load();
    expect(savedState.lastDevice).toBe('Controller A');

    // Verify second iteration showed no-devices error
    expect(ui.port.showError).toHaveBeenCalledWith(
      'No MIDI input devices found. Connect a device and try again.',
    );
  });

  // -----------------------------------------------------------------------

  it('remembers last device across runs', async () => {
    const statePath = join(tmpDir, 'state.json');

    // Run 1: no saved state, select Controller B (index 1), disconnect immediately
    const run1 = buildApp({
      devicesSequence: [DEVICES, []], // first: devices, second: empty -> exit
      connectionChecks: [false],      // immediate disconnect
      selectedDeviceIndex: 1,
      statePath,
    });

    await run1.app.run(run1.configPath, true);

    // selectDevice was called in run 1
    expect(run1.ui.port.selectDevice).toHaveBeenCalledWith(DEVICES);

    // Verify state was persisted
    const savedState = await run1.stateAdapter.load();
    expect(savedState.lastDevice).toBe('Controller B');

    // Run 2: state has lastDevice = "Controller B", should auto-connect
    const run2 = buildApp({
      devicesSequence: [DEVICES, []], // first: devices, second: empty -> exit
      connectionChecks: [false],      // immediate disconnect
      statePath,
    });

    await run2.app.run(run2.configPath, true);

    // selectDevice should NOT have been called in run 2
    expect(run2.ui.port.selectDevice).not.toHaveBeenCalled();
    expect(run2.ui.port.showInfo).toHaveBeenCalledWith('Auto-connecting to last device: Controller B');

    // Verify it opened the right device index (Controller B = index 1)
    expect(run2.mockInput.input.open).toHaveBeenCalledWith(1);
  });

  // -----------------------------------------------------------------------

  it('processes expression pedal through linear mapping', async () => {
    const { app, mockInput, mockOutput, ui, configPath } = buildApp({
      devicesSequence: [DEVICES, []],
      connectionChecks: [false],
    });

    await app.run(configPath, true);

    // CC 4, linear 0-127 -> 0-127
    mockInput.simulateMessage({ channel: 0, cc: 4, value: 0 });
    mockInput.simulateMessage({ channel: 0, cc: 4, value: 64 });
    mockInput.simulateMessage({ channel: 0, cc: 4, value: 127 });

    // Extract CC4 output values
    const cc4Outputs = mockOutput.sentMessages.filter(m => m[1] === 4);
    expect(cc4Outputs).toHaveLength(3);
    expect(cc4Outputs[0]).toEqual([0xb0, 4, 0]);
    expect(cc4Outputs[1]).toEqual([0xb0, 4, 64]);
    expect(cc4Outputs[2]).toEqual([0xb0, 4, 127]);

    // Verify UI logged each mapping
    const cc4Logs = ui.mappingLogs.filter(l => l.cc === 4);
    expect(cc4Logs).toEqual([
      { cc: 4, original: 0, mapped: 0 },
      { cc: 4, original: 64, mapped: 64 },
      { cc: 4, original: 127, mapped: 127 },
    ]);
  });

  // -----------------------------------------------------------------------

  it('toggle sustain on/off through full pipeline', async () => {
    const { app, mockInput, mockOutput, ui, configPath } = buildApp({
      devicesSequence: [DEVICES, []],
      connectionChecks: [false],
    });

    await app.run(configPath, true);

    // Press CC 64, value 127 -> toggle ON -> output 127
    mockInput.simulateMessage({ channel: 0, cc: 64, value: 127 });
    // Release CC 64, value 0 -> stays ON -> output 127
    mockInput.simulateMessage({ channel: 0, cc: 64, value: 0 });
    // Press CC 64, value 127 -> toggle OFF -> output 0
    mockInput.simulateMessage({ channel: 0, cc: 64, value: 127 });

    const cc64Outputs = mockOutput.sentMessages.filter(m => m[1] === 64);
    expect(cc64Outputs).toHaveLength(3);
    expect(cc64Outputs[0]).toEqual([0xb0, 64, 127]); // toggle ON
    expect(cc64Outputs[1]).toEqual([0xb0, 64, 127]); // release: stays ON
    expect(cc64Outputs[2]).toEqual([0xb0, 64, 0]);   // toggle OFF

    // Verify UI logs
    const cc64Logs = ui.mappingLogs.filter(l => l.cc === 64);
    expect(cc64Logs[0]!.mapped).toBe(127);
    expect(cc64Logs[1]!.mapped).toBe(127);
    expect(cc64Logs[2]!.mapped).toBe(0);
  });

  // -----------------------------------------------------------------------

  it('smoothing averages values over window', async () => {
    const { app, mockInput, mockOutput, ui, configPath } = buildApp({
      devicesSequence: [DEVICES, []],
      connectionChecks: [false],
    });

    await app.run(configPath, true);

    // CC 11 has smoothing=3. Send 3 values: 60, 90, 120
    // Buffer after each:
    //   [60]         -> avg = 60
    //   [60, 90]     -> avg = 75
    //   [60, 90, 120] -> avg = 90
    mockInput.simulateMessage({ channel: 0, cc: 11, value: 60 });
    mockInput.simulateMessage({ channel: 0, cc: 11, value: 90 });
    mockInput.simulateMessage({ channel: 0, cc: 11, value: 120 });

    const cc11Outputs = mockOutput.sentMessages.filter(m => m[1] === 11);
    expect(cc11Outputs).toHaveLength(3);

    // First message: avg([60]) = 60
    expect(cc11Outputs[0]).toEqual([0xb0, 11, 60]);
    // Second message: avg([60, 90]) = 75
    expect(cc11Outputs[1]).toEqual([0xb0, 11, 75]);
    // Third message: avg([60, 90, 120]) = 90
    expect(cc11Outputs[2]).toEqual([0xb0, 11, 90]);

    // Verify the final UI log entry shows avg=90
    const cc11Logs = ui.mappingLogs.filter(l => l.cc === 11);
    expect(cc11Logs[2]!.mapped).toBe(90);
  });

  // -----------------------------------------------------------------------

  it('macro generates additional CC outputs', async () => {
    const { app, mockInput, mockOutput, configPath } = buildApp({
      devicesSequence: [DEVICES, []],
      connectionChecks: [false],
    });

    await app.run(configPath, true);

    // CC 1 has a macro that also outputs to CC 74.
    // CC 1 has no dedicated rule, so it passes through unmapped.
    // Macro output: CC 74, linear 0-127 -> 0-127, so value 100 -> 100
    mockInput.simulateMessage({ channel: 0, cc: 1, value: 100 });

    // Main CC 1 output
    const cc1Outputs = mockOutput.sentMessages.filter(m => m[1] === 1);
    expect(cc1Outputs.length).toBeGreaterThanOrEqual(1);
    expect(cc1Outputs[0]).toEqual([0xb0, 1, 100]);

    // Macro CC 74 output
    const cc74Outputs = mockOutput.sentMessages.filter(m => m[1] === 74);
    expect(cc74Outputs).toHaveLength(1);
    expect(cc74Outputs[0]).toEqual([0xb0, 74, 100]);
  });

  // -----------------------------------------------------------------------

  it('handles invalid config path gracefully', async () => {
    const { app } = buildApp({
      devicesSequence: [DEVICES, []],
      connectionChecks: [false],
    });

    const nonexistentPath = join(tmpDir, 'does-not-exist.yaml');

    await expect(app.run(nonexistentPath, true)).rejects.toThrow();
  });

  // -----------------------------------------------------------------------

  it('handles multiple messages across different rules in a single session', async () => {
    const { app, mockInput, mockOutput, ui, configPath } = buildApp({
      devicesSequence: [DEVICES, []],
      connectionChecks: [false],
    });

    await app.run(configPath, true);

    // Mix of different CCs
    mockInput.simulateMessage({ channel: 0, cc: 4, value: 50 });   // expression
    mockInput.simulateMessage({ channel: 0, cc: 64, value: 127 }); // toggle on
    mockInput.simulateMessage({ channel: 0, cc: 11, value: 100 }); // smoothed
    mockInput.simulateMessage({ channel: 0, cc: 4, value: 100 });  // expression again
    mockInput.simulateMessage({ channel: 0, cc: 64, value: 0 });   // toggle release (stays on)
    mockInput.simulateMessage({ channel: 0, cc: 11, value: 50 });  // smoothed (avg of [100,50]=75)

    expect(ui.mappingLogs).toHaveLength(6);

    // Expression: linear pass-through
    expect(ui.mappingLogs[0]).toEqual({ cc: 4, original: 50, mapped: 50 });
    expect(ui.mappingLogs[3]).toEqual({ cc: 4, original: 100, mapped: 100 });

    // Toggle: on after first press, stays on after release
    expect(ui.mappingLogs[1]).toEqual({ cc: 64, original: 127, mapped: 127 });
    expect(ui.mappingLogs[4]).toEqual({ cc: 64, original: 0, mapped: 127 });

    // Smoothed: window grows
    expect(ui.mappingLogs[2]).toEqual({ cc: 11, original: 100, mapped: 100 }); // avg([100])=100
    expect(ui.mappingLogs[5]).toEqual({ cc: 11, original: 50, mapped: 75 });   // avg([100,50])=75
  });

  // -----------------------------------------------------------------------

  it('state persists correctly through JsonStateAdapter', async () => {
    const statePath = join(tmpDir, 'nested', 'deep', 'state.json');

    const { app, configPath } = buildApp({
      devicesSequence: [DEVICES, []],
      connectionChecks: [false],
      selectedDeviceIndex: 0,
      statePath,
    });

    await app.run(configPath, true);

    // Verify state file was created in nested path
    const stateAdapter = new JsonStateAdapter(statePath);
    const state = await stateAdapter.load();
    expect(state.lastDevice).toBe('Controller A');
  });

  // -----------------------------------------------------------------------

  it('unrecognized CC passes through with NRPN preamble', async () => {
    const { app, mockInput, mockOutput, ui, configPath } = buildApp({
      devicesSequence: [DEVICES, []],
      connectionChecks: [false],
    });

    await app.run(configPath, true);

    // CC 80 is not in any rule or macro
    mockInput.simulateMessage({ channel: 0, cc: 80, value: 42 });

    // Should still produce output: NRPN preamble + passthrough
    const cc80Outputs = mockOutput.sentMessages.filter(m => m[1] === 80);
    expect(cc80Outputs.length).toBeGreaterThanOrEqual(1);
    // Value passes through unchanged
    expect(cc80Outputs[0]).toEqual([0xb0, 80, 42]);

    // UI should have logged it
    expect(ui.mappingLogs).toHaveLength(1);
    expect(ui.mappingLogs[0]).toEqual({ cc: 80, original: 42, mapped: 42 });
  });
});
