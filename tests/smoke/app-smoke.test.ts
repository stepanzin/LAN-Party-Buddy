import { describe, it, expect, mock } from 'bun:test';
import { MidiMapperApp, type MidiMapperDeps } from '../../src/app/midi-mapper.app.ts';
import type { MidiInputPort, MidiMessageHandler, MidiErrorHandler } from '../../src/ports/midi-input.port.ts';
import type { MidiOutputPort } from '../../src/ports/midi-output.port.ts';
import type { DeviceDiscoveryPort, MidiDevice } from '../../src/ports/device-discovery.port.ts';
import type { UserInterfacePort } from '../../src/ports/user-interface.port.ts';
import type { ConfigReaderPort } from '../../src/ports/config-reader.port.ts';
import type { StateStorePort, AppState } from '../../src/ports/state-store.port.ts';
import type { AppConfig } from '../../src/domain/config.ts';
import { YamlConfigAdapter } from '../../src/adapters/yaml-config.adapter.ts';
import path from 'node:path';

// --- Helpers ---

const DEVICES: MidiDevice[] = [
  { index: 0, name: 'Test Controller' },
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
    simulateMessage: (msg: { channel: number; cc: number; value: number }) => messageHandler?.(msg),
    simulateError: (err: Error) => errorHandler?.(err),
  };
}

function createMockMidiOutput(): MidiOutputPort {
  return {
    openVirtual: mock((_name: string) => {}),
    send: mock((_msg: readonly [number, number, number]) => {}),
    close: mock(() => {}),
  };
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

function createMockUI(selectedDeviceIndex = 0): UserInterfacePort {
  return {
    selectDevice: mock((_devices: MidiDevice[]) => Promise.resolve(selectedDeviceIndex)),
    showInfo: mock((_msg: string) => {}),
    showWarning: mock((_msg: string) => {}),
    showError: mock((_msg: string) => {}),
    logMapping: mock((_cc: number, _orig: number, _mapped: number) => {}),
  };
}

function createMockConfigReader(config: AppConfig): ConfigReaderPort {
  return {
    load: mock((_source: string) => Promise.resolve(config)),
  };
}

function createMockStateStore(initialState: AppState = {}): StateStorePort {
  return {
    load: mock(() => Promise.resolve(initialState)),
    save: mock((_state: AppState) => Promise.resolve()),
  };
}

type MockDepsOverrides = Partial<{
  midiInput: ReturnType<typeof createMockMidiInput>;
  midiOutput: MidiOutputPort;
  deviceDiscovery: DeviceDiscoveryPort;
  ui: UserInterfacePort;
  configReader: ConfigReaderPort;
  stateStore: StateStorePort;
}>;

function createMockDeps(overrides: MockDepsOverrides = {}) {
  const defaultConfig: AppConfig = {
    deviceName: 'SmokeTest Output',
    rules: [
      { cc: 1, label: 'Mod Wheel', inputMin: 0, inputMax: 127, outputMin: 0, outputMax: 127, curve: 'linear' as const },
    ],
  };

  const mockInput = overrides.midiInput ?? createMockMidiInput();
  const midiOutput = overrides.midiOutput ?? createMockMidiOutput();
  const deviceDiscovery = overrides.deviceDiscovery ?? createMockDeviceDiscovery([DEVICES, []], [false]);
  const ui = overrides.ui ?? createMockUI();
  const configReader = overrides.configReader ?? createMockConfigReader(defaultConfig);
  const stateStore = overrides.stateStore ?? createMockStateStore();

  const deps: MidiMapperDeps = {
    midiInput: mockInput.input,
    midiOutput,
    deviceDiscovery,
    ui,
    configReader,
    stateStore,
  };

  return { deps, mockInput, midiOutput, deviceDiscovery, ui, configReader, stateStore };
}

// --- Smoke Tests ---

describe('Smoke: MidiMapperApp', () => {

  it('starts and exits gracefully when no devices are connected', async () => {
    const deviceDiscovery = createMockDeviceDiscovery([[]], []);
    const ui = createMockUI();
    const { deps } = createMockDeps({ deviceDiscovery, ui });

    const app = new MidiMapperApp(deps, 10);

    // Should not throw
    await app.run('config.yaml');

    expect(ui.showError).toHaveBeenCalledWith(
      'No MIDI input devices found. Connect a device and try again.',
    );
  });

  it('handles valid config.yaml without crashing', async () => {
    const configPath = path.resolve(import.meta.dir, '../../config.yaml');
    const yamlAdapter = new YamlConfigAdapter();

    const midiInput = createMockMidiInput();
    const midiOutput = createMockMidiOutput();
    const deviceDiscovery = createMockDeviceDiscovery(
      [DEVICES, []], // first: device present, second: no devices -> exit
      [false],       // immediate disconnect
    );
    const ui = createMockUI(0);
    const stateStore = createMockStateStore();

    const deps: MidiMapperDeps = {
      midiInput: midiInput.input,
      midiOutput,
      deviceDiscovery,
      ui,
      configReader: yamlAdapter,
      stateStore,
    };

    const app = new MidiMapperApp(deps, 10);

    // Should not throw when loading and running with real config.yaml
    await app.run(configPath);

    // Verify it actually opened ports (config was loaded and processed)
    expect(midiInput.input.open).toHaveBeenCalledWith(0);
    expect(midiOutput.openVirtual).toHaveBeenCalledWith('MIDI Mapper Output');
  });

  it('handles config with all feature types (curves, smoothing, toggle, macros, invert)', async () => {
    const fullConfig: AppConfig = {
      deviceName: 'Full Feature Test',
      rules: [
        { cc: 1, label: 'Linear', inputMin: 0, inputMax: 127, outputMin: 0, outputMax: 127, curve: 'linear' as const },
        { cc: 2, label: 'Log + Smoothing', inputMin: 0, inputMax: 127, outputMin: 0, outputMax: 127, curve: 'logarithmic' as const, smoothing: 4 },
        { cc: 3, label: 'Exp + Invert', inputMin: 0, inputMax: 127, outputMin: 0, outputMax: 127, curve: 'exponential' as const, invert: true },
        { cc: 4, label: 'S-Curve + DeadZone', inputMin: 0, inputMax: 127, outputMin: 0, outputMax: 127, curve: 's-curve' as const, deadZoneMin: 10, deadZoneMax: 117 },
        { cc: 5, label: 'Toggle Mode', inputMin: 0, inputMax: 127, outputMin: 0, outputMax: 127, curve: 'linear' as const, mode: 'toggle' as const },
      ],
      macros: [
        {
          input: 10,
          label: 'Test Macro',
          outputs: [
            { cc: 74, label: 'Filter', outputMin: 0, outputMax: 127, curve: 'exponential' as const },
            { cc: 71, label: 'Resonance', outputMin: 100, outputMax: 20, curve: 'linear' as const, invert: true },
          ],
        },
      ],
    };

    const midiInput = createMockMidiInput();
    const midiOutput = createMockMidiOutput();
    const deviceDiscovery = createMockDeviceDiscovery(
      [DEVICES, []],
      [false],
    );
    const ui = createMockUI(0);
    const configReader = createMockConfigReader(fullConfig);

    const { deps } = createMockDeps({ midiInput, midiOutput, deviceDiscovery, ui, configReader });
    const app = new MidiMapperApp(deps, 10);

    await app.run('config.yaml');

    // Send messages through each rule and the macro
    const testMessages = [
      { channel: 0, cc: 1, value: 64 },   // linear
      { channel: 0, cc: 2, value: 80 },   // logarithmic + smoothing
      { channel: 0, cc: 2, value: 85 },   // second smoothing sample
      { channel: 0, cc: 3, value: 100 },  // exponential + invert
      { channel: 0, cc: 4, value: 5 },    // s-curve + dead zone (below min)
      { channel: 0, cc: 4, value: 64 },   // s-curve + dead zone (normal)
      { channel: 0, cc: 4, value: 125 },  // s-curve + dead zone (above max)
      { channel: 0, cc: 5, value: 127 },  // toggle on
      { channel: 0, cc: 5, value: 0 },    // toggle release
      { channel: 0, cc: 5, value: 127 },  // toggle off
      { channel: 0, cc: 10, value: 64 },  // macro
    ];

    for (const msg of testMessages) {
      midiInput.simulateMessage(msg);
    }

    // Verify all messages were processed (logMapping called for each)
    expect(ui.logMapping).toHaveBeenCalledTimes(testMessages.length);
    // Verify output was sent for each message (at least NRPN preamble + main)
    expect((midiOutput.send as ReturnType<typeof mock>).mock.calls.length).toBeGreaterThanOrEqual(testMessages.length * 3);
  });

  it('survives rapid message throughput (100 messages)', async () => {
    const midiInput = createMockMidiInput();
    const midiOutput = createMockMidiOutput();
    const deviceDiscovery = createMockDeviceDiscovery(
      [DEVICES, []],
      [false],
    );
    const ui = createMockUI(0);

    const { deps } = createMockDeps({ midiInput, midiOutput, deviceDiscovery, ui });
    const app = new MidiMapperApp(deps, 10);

    await app.run('config.yaml');

    // Fire 100 messages rapidly
    for (let i = 0; i < 100; i++) {
      midiInput.simulateMessage({ channel: 0, cc: 1, value: i % 128 });
    }

    // All 100 messages should have been logged
    expect(ui.logMapping).toHaveBeenCalledTimes(100);

    // Each message produces at least 3 sends (NRPN preamble + main)
    const sendCount = (midiOutput.send as ReturnType<typeof mock>).mock.calls.length;
    expect(sendCount).toBe(300);
  });

  it('handles device disconnect and reconnect cycle', async () => {
    const midiInput = createMockMidiInput();
    const midiOutput = createMockMidiOutput();
    const ui = createMockUI(0);

    // First iteration: device present, polls a few times then disconnects
    // Second iteration: no devices -> exit
    const deviceDiscovery = createMockDeviceDiscovery(
      [DEVICES, []], // first listDevices: devices present; second: empty -> exits
      [true, true, false], // poll: connected, connected, disconnected
    );
    const stateStore = createMockStateStore();

    const { deps } = createMockDeps({ midiInput, midiOutput, deviceDiscovery, ui, stateStore });
    const app = new MidiMapperApp(deps, 10);

    await app.run('config.yaml');

    // Verify disconnect warning was shown
    expect(ui.showWarning).toHaveBeenCalledWith('Device "Test Controller" disconnected.');

    // Verify ports were closed after disconnect
    expect(midiInput.input.close).toHaveBeenCalled();
    expect(midiOutput.close).toHaveBeenCalled();

    // Verify loop continued: listDevices called twice (first iteration + second iteration)
    const listCalls = (deviceDiscovery.listDevices as ReturnType<typeof mock>).mock.calls.length;
    expect(listCalls).toBe(2);

    // Verify the second iteration exited cleanly via "no devices" path
    expect(ui.showError).toHaveBeenCalledWith(
      'No MIDI input devices found. Connect a device and try again.',
    );
  });
});
