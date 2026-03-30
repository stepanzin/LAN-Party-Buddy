import { describe, it, expect, mock, beforeEach } from 'bun:test';

import { MidiMapperApp, type MidiMapperDeps } from '../../src/app/midi-mapper.app.ts';
import type { MidiInputPort, MidiMessageHandler, MidiErrorHandler } from '../../src/ports/midi-input.port.ts';
import type { MidiOutputPort } from '../../src/ports/midi-output.port.ts';
import type { DeviceDiscoveryPort, MidiDevice } from '../../src/ports/device-discovery.port.ts';
import type { UserInterfacePort } from '../../src/ports/user-interface.port.ts';
import type { ConfigReaderPort } from '../../src/ports/config-reader.port.ts';
import type { StateStorePort, AppState } from '../../src/ports/state-store.port.ts';
import type { MonitorPort } from '../../src/ports/monitor.port.ts';
import type { AppConfig } from '../../src/domain/config.ts';

// --- Helpers ---

const TEST_CONFIG: AppConfig = {
  deviceName: 'VirtualOut',
  rules: [
    { cc: 10, label: 'Volume', inputMin: 0, inputMax: 127, outputMin: 0, outputMax: 127, curve: 'linear' as const },
  ],
};

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
  devicesSequence: MidiDevice[][] = [DEVICES],
  connectionChecks: boolean[] = [true],
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
    start: mock(() => {}),
    stop: mock(() => {}),
    waitForExit: mock(() => Promise.resolve()),
    showWelcome: mock(() => Promise.resolve('local' as const)),
    selectDevice: mock((_devices: MidiDevice[]) => Promise.resolve(selectedDeviceIndex)),
    showInfo: mock((_msg: string) => {}),
    showWarning: mock((_msg: string) => {}),
    showError: mock((_msg: string) => {}),
    logMapping: mock((_cc: number, _orig: number, _mapped: number) => {}),
  };
}

function createMockConfigReader(config: AppConfig = TEST_CONFIG): ConfigReaderPort {
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

function createMockMonitor(): MonitorPort {
  return {
    start: mock(() => {}),
    stop: mock(() => {}),
    onMidiActivity: mock((_cc: number, _value: number, _mappedValue: number, _ruleLabel?: string) => {}),
    onMacroActivity: mock((_inputCc: number, _outputs: Array<{ cc: number; value: number }>) => {}),
    onUnmappedCC: mock((_cc: number, _value: number) => {}),
    setDevice: mock((_name: string) => {}),
    setConnectionStatus: mock((_connected: boolean) => {}),
  };
}

function createDeps(overrides: Partial<{
  midiInput: ReturnType<typeof createMockMidiInput>;
  midiOutput: MidiOutputPort;
  deviceDiscovery: DeviceDiscoveryPort;
  ui: UserInterfacePort;
  configReader: ConfigReaderPort;
  stateStore: StateStorePort;
  monitor: MonitorPort;
}> = {}) {
  const mockInput = overrides.midiInput ?? createMockMidiInput();
  const midiOutput = overrides.midiOutput ?? createMockMidiOutput();
  const deviceDiscovery = overrides.deviceDiscovery ?? createMockDeviceDiscovery();
  const ui = overrides.ui ?? createMockUI();
  const configReader = overrides.configReader ?? createMockConfigReader();
  const stateStore = overrides.stateStore ?? createMockStateStore();

  const configWriter = { save: mock(() => Promise.resolve()) };

  const deps: MidiMapperDeps = {
    midiInput: mockInput.input,
    midiOutput,
    deviceDiscovery,
    ui,
    configReader,
    configWriter,
    stateStore,
    ...(overrides.monitor ? { monitor: overrides.monitor } : {}),
  };

  return { deps, mockInput, midiOutput, deviceDiscovery, ui, configReader, stateStore };
}

// --- Tests ---

describe('MidiMapperApp', () => {

  // --- Config loading ---

  describe('Config loading', () => {
    it('loads config from configReader on run()', async () => {
      const deviceDiscovery = createMockDeviceDiscovery([[]]);
      const configReader = createMockConfigReader();
      const { deps } = createDeps({ configReader, deviceDiscovery });

      const app = new MidiMapperApp(deps, 10);
      await app.run('my-config.yaml', true);

      expect(configReader.load).toHaveBeenCalledWith('my-config.yaml');
    });

    it('calls buildRules with loaded config', async () => {
      // We verify indirectly: if config loads and rules are built, the message handler
      // uses them. We test this by sending a message and checking the output uses the rule.
      const deviceDiscovery = createMockDeviceDiscovery(
        [DEVICES, []], // first call returns devices, second returns empty to exit loop
        [false],       // immediate disconnect
      );
      const stateStore = createMockStateStore();
      const midiInput = createMockMidiInput();
      const midiOutput = createMockMidiOutput();
      const ui = createMockUI(0);

      const { deps } = createDeps({ deviceDiscovery, stateStore, midiInput, midiOutput, ui });
      const app = new MidiMapperApp(deps, 10);
      await app.run('config.yaml', true);

      // After wiring, simulate a message. CC 10 has a rule in TEST_CONFIG.
      midiInput.simulateMessage({ channel: 0, cc: 10, value: 64 });

      // The mapping should have been applied (buildRules was called)
      expect(ui.logMapping).toHaveBeenCalled();
    });
  });

  // --- No devices ---

  describe('No devices', () => {
    it('shows error and returns when no devices found', async () => {
      const deviceDiscovery = createMockDeviceDiscovery([[]]);
      const ui = createMockUI();
      const { deps } = createDeps({ deviceDiscovery, ui });

      const app = new MidiMapperApp(deps, 10);
      await app.run('config.yaml', true);

      expect(ui.showError).toHaveBeenCalledWith(
        'No MIDI input devices found. Connect a device and try again.',
      );
    });
  });

  // --- Auto-connect ---

  describe('Auto-connect', () => {
    it('auto-connects when lastDevice matches a connected device', async () => {
      const deviceDiscovery = createMockDeviceDiscovery(
        [DEVICES, []],
        [false],
      );
      const stateStore = createMockStateStore({ lastDevice: 'Controller A' });
      const midiInput = createMockMidiInput();
      const ui = createMockUI();
      const { deps } = createDeps({ deviceDiscovery, stateStore, midiInput, ui });

      const app = new MidiMapperApp(deps, 10);
      await app.run('config.yaml', true);

      expect(midiInput.input.open).toHaveBeenCalledWith(0);
      // selectDevice should NOT have been called
      expect(ui.selectDevice).not.toHaveBeenCalled();
    });

    it('shows info about auto-connecting', async () => {
      const deviceDiscovery = createMockDeviceDiscovery(
        [DEVICES, []],
        [false],
      );
      const stateStore = createMockStateStore({ lastDevice: 'Controller A' });
      const midiInput = createMockMidiInput();
      const ui = createMockUI();
      const { deps } = createDeps({ deviceDiscovery, stateStore, midiInput, ui });

      const app = new MidiMapperApp(deps, 10);
      await app.run('config.yaml', true);

      expect(ui.showInfo).toHaveBeenCalledWith('Auto-connecting to last device: Controller A');
    });

    it('falls back to selectDevice when lastDevice not found', async () => {
      const deviceDiscovery = createMockDeviceDiscovery(
        [DEVICES, []],
        [false],
      );
      const stateStore = createMockStateStore({ lastDevice: 'NonExistent Device' });
      const ui = createMockUI(1);
      const midiInput = createMockMidiInput();
      const { deps } = createDeps({ deviceDiscovery, stateStore, ui, midiInput });

      const app = new MidiMapperApp(deps, 10);
      await app.run('config.yaml', true);

      expect(ui.selectDevice).toHaveBeenCalledWith(DEVICES);
    });

    it('shows info that last device not found', async () => {
      const deviceDiscovery = createMockDeviceDiscovery(
        [DEVICES, []],
        [false],
      );
      const stateStore = createMockStateStore({ lastDevice: 'NonExistent Device' });
      const ui = createMockUI(1);
      const midiInput = createMockMidiInput();
      const { deps } = createDeps({ deviceDiscovery, stateStore, ui, midiInput });

      const app = new MidiMapperApp(deps, 10);
      await app.run('config.yaml', true);

      expect(ui.showInfo).toHaveBeenCalledWith('Last device "NonExistent Device" not found.');
    });

    it('calls selectDevice when no lastDevice in state', async () => {
      const deviceDiscovery = createMockDeviceDiscovery(
        [DEVICES, []],
        [false],
      );
      const stateStore = createMockStateStore({});
      const ui = createMockUI(0);
      const midiInput = createMockMidiInput();
      const { deps } = createDeps({ deviceDiscovery, stateStore, ui, midiInput });

      const app = new MidiMapperApp(deps, 10);
      await app.run('config.yaml', true);

      expect(ui.selectDevice).toHaveBeenCalledWith(DEVICES);
    });
  });

  // --- Connection ---

  describe('Connection', () => {
    it('opens input port with correct device index', async () => {
      const deviceDiscovery = createMockDeviceDiscovery(
        [DEVICES, []],
        [false],
      );
      const stateStore = createMockStateStore({});
      const ui = createMockUI(1); // select device at index 1
      const midiInput = createMockMidiInput();
      const { deps } = createDeps({ deviceDiscovery, stateStore, ui, midiInput });

      const app = new MidiMapperApp(deps, 10);
      await app.run('config.yaml', true);

      expect(midiInput.input.open).toHaveBeenCalledWith(1);
    });

    it('opens virtual output with config device name', async () => {
      const deviceDiscovery = createMockDeviceDiscovery(
        [DEVICES, []],
        [false],
      );
      const midiOutput = createMockMidiOutput();
      const midiInput = createMockMidiInput();
      const { deps } = createDeps({ deviceDiscovery, midiOutput, midiInput });

      const app = new MidiMapperApp(deps, 10);
      await app.run('config.yaml', true);

      expect(midiOutput.openVirtual).toHaveBeenCalledWith('VirtualOut');
    });

    it('saves selected device name to state store', async () => {
      const deviceDiscovery = createMockDeviceDiscovery(
        [DEVICES, []],
        [false],
      );
      const stateStore = createMockStateStore({});
      const ui = createMockUI(1); // select Controller B (index 1)
      const midiInput = createMockMidiInput();
      const { deps } = createDeps({ deviceDiscovery, stateStore, ui, midiInput });

      const app = new MidiMapperApp(deps, 10);
      await app.run('config.yaml', true);

      expect(stateStore.save).toHaveBeenCalledWith({ lastDevice: 'Controller B' });
    });

    it('shows proxy info message', async () => {
      const deviceDiscovery = createMockDeviceDiscovery(
        [DEVICES, []],
        [false],
      );
      const ui = createMockUI(0);
      const midiInput = createMockMidiInput();
      const { deps } = createDeps({ deviceDiscovery, ui, midiInput });

      const app = new MidiMapperApp(deps, 10);
      await app.run('config.yaml', true);

      expect(ui.showInfo).toHaveBeenCalledWith(
        'Proxying MIDI signals -> VirtualOut\nDevice: Controller A',
      );
    });
  });

  // --- Message handling ---

  describe('Message handling', () => {
    it('wires message handler that calls processMidiMessage', async () => {
      const deviceDiscovery = createMockDeviceDiscovery(
        [DEVICES, []],
        [false],
      );
      const midiInput = createMockMidiInput();
      const midiOutput = createMockMidiOutput();
      const ui = createMockUI(0);
      const { deps } = createDeps({ deviceDiscovery, midiInput, midiOutput, ui });

      const app = new MidiMapperApp(deps, 10);
      await app.run('config.yaml', true);

      // onMessage should have been called (handler wired)
      expect(midiInput.input.onMessage).toHaveBeenCalled();

      // Simulate a MIDI message
      midiInput.simulateMessage({ channel: 0, cc: 10, value: 64 });

      // processMidiMessage should produce output messages that get sent
      expect(midiOutput.send).toHaveBeenCalled();
    });

    it('sends all output messages from processMidiMessage result', async () => {
      const deviceDiscovery = createMockDeviceDiscovery(
        [DEVICES, []],
        [false],
      );
      const midiInput = createMockMidiInput();
      const midiOutput = createMockMidiOutput();
      const ui = createMockUI(0);
      const { deps } = createDeps({ deviceDiscovery, midiInput, midiOutput, ui });

      const app = new MidiMapperApp(deps, 10);
      await app.run('config.yaml', true);

      // CC 10 has a rule, so processMidiMessage returns NRPN + mapped message
      midiInput.simulateMessage({ channel: 0, cc: 10, value: 64 });

      // NRPN preamble (2 msgs) + main output (1 msg) = 3 messages
      expect(midiOutput.send).toHaveBeenCalledTimes(3);
    });

    it('logs mapping via ui.logMapping', async () => {
      const deviceDiscovery = createMockDeviceDiscovery(
        [DEVICES, []],
        [false],
      );
      const midiInput = createMockMidiInput();
      const ui = createMockUI(0);
      const { deps } = createDeps({ deviceDiscovery, midiInput, ui });

      const app = new MidiMapperApp(deps, 10);
      await app.run('config.yaml', true);

      midiInput.simulateMessage({ channel: 0, cc: 10, value: 64 });

      expect(ui.logMapping).toHaveBeenCalledWith(10, 64, expect.any(Number));
    });

    it('updates engine state between messages', async () => {
      const deviceDiscovery = createMockDeviceDiscovery(
        [DEVICES, []],
        [false],
      );
      const midiInput = createMockMidiInput();
      const midiOutput = createMockMidiOutput();
      const ui = createMockUI(0);
      const { deps } = createDeps({ deviceDiscovery, midiInput, midiOutput, ui });

      const app = new MidiMapperApp(deps, 10);
      await app.run('config.yaml', true);

      // CC 20 has no rule -> prevCode becomes 20
      midiInput.simulateMessage({ channel: 0, cc: 20, value: 100 });
      // CC 30 has no rule -> should emit [status, 20, 0] to clear prevCode
      midiInput.simulateMessage({ channel: 0, cc: 30, value: 100 });

      // The second message should have emitted a "clear prev" message [status, 20, 0]
      const sendCalls = (midiOutput.send as ReturnType<typeof mock>).mock.calls;
      const clearMsg = sendCalls.find(
        (call: any) => call[0][1] === 20 && call[0][2] === 0,
      );
      expect(clearMsg).toBeDefined();
    });
  });

  // --- Error handling ---

  describe('Error handling', () => {
    it('wires error handler that shows error via ui', async () => {
      const deviceDiscovery = createMockDeviceDiscovery(
        [DEVICES, []],
        [false],
      );
      const midiInput = createMockMidiInput();
      const ui = createMockUI(0);
      const { deps } = createDeps({ deviceDiscovery, midiInput, ui });

      const app = new MidiMapperApp(deps, 10);
      await app.run('config.yaml', true);

      expect(midiInput.input.onError).toHaveBeenCalled();

      midiInput.simulateError(new Error('Device lost'));
      expect(ui.showError).toHaveBeenCalledWith('MIDI input error: Device lost');
    });
  });

  // --- Disconnect + reconnect ---

  describe('Disconnect + reconnect', () => {
    it('polls for device disconnect', async () => {
      const deviceDiscovery = createMockDeviceDiscovery(
        [DEVICES, []],
        [true, true, false], // connected, connected, disconnected
      );
      const midiInput = createMockMidiInput();
      const ui = createMockUI(0);
      const { deps } = createDeps({ deviceDiscovery, midiInput, ui });

      const app = new MidiMapperApp(deps, 10);
      await app.run('config.yaml', true);

      // isDeviceConnected should have been called multiple times
      expect(deviceDiscovery.isDeviceConnected).toHaveBeenCalled();
      const callCount = (deviceDiscovery.isDeviceConnected as ReturnType<typeof mock>).mock.calls.length;
      expect(callCount).toBeGreaterThanOrEqual(3);
    });

    it('shows warning on disconnect', async () => {
      const deviceDiscovery = createMockDeviceDiscovery(
        [DEVICES, []],
        [false], // immediate disconnect
      );
      const midiInput = createMockMidiInput();
      const ui = createMockUI(0);
      const { deps } = createDeps({ deviceDiscovery, midiInput, ui });

      const app = new MidiMapperApp(deps, 10);
      await app.run('config.yaml', true);

      expect(ui.showWarning).toHaveBeenCalledWith('Device "Controller A" disconnected.');
    });

    it('closes both ports on disconnect', async () => {
      const deviceDiscovery = createMockDeviceDiscovery(
        [DEVICES, []],
        [false],
      );
      const midiInput = createMockMidiInput();
      const midiOutput = createMockMidiOutput();
      const ui = createMockUI(0);
      const { deps } = createDeps({ deviceDiscovery, midiInput, midiOutput, ui });

      const app = new MidiMapperApp(deps, 10);
      await app.run('config.yaml', true);

      expect(midiInput.input.close).toHaveBeenCalled();
      expect(midiOutput.close).toHaveBeenCalled();
    });

    it('loops back to device selection after disconnect', async () => {
      // First iteration: devices present, disconnect detected
      // Second iteration: no devices, exits via "no devices" path
      const deviceDiscovery = createMockDeviceDiscovery(
        [DEVICES, []], // first: devices, second: empty
        [false],       // immediate disconnect on first iteration
      );
      const midiInput = createMockMidiInput();
      const ui = createMockUI(0);
      const { deps } = createDeps({ deviceDiscovery, midiInput, ui });

      const app = new MidiMapperApp(deps, 10);
      await app.run('config.yaml', true);

      // listDevices called twice: first iteration + second iteration
      const listCalls = (deviceDiscovery.listDevices as ReturnType<typeof mock>).mock.calls.length;
      expect(listCalls).toBe(2);

      // Second iteration should show "no devices" error
      expect(ui.showError).toHaveBeenCalledWith(
        'No MIDI input devices found. Connect a device and try again.',
      );
    });
  });

  // --- MonitorPort integration ---

  describe('MonitorPort integration', () => {
    it('calls monitor.onMidiActivity when rule matches', async () => {
      const deviceDiscovery = createMockDeviceDiscovery(
        [DEVICES, []],
        [false],
      );
      const midiInput = createMockMidiInput();
      const monitor = createMockMonitor();
      const { deps } = createDeps({ deviceDiscovery, midiInput, monitor });

      const app = new MidiMapperApp(deps, 10);
      await app.run('config.yaml', true);

      // CC 10 has a rule in TEST_CONFIG with label 'Volume'
      midiInput.simulateMessage({ channel: 0, cc: 10, value: 64 });

      expect(monitor.onMidiActivity).toHaveBeenCalledWith(10, 64, expect.any(Number), 'Volume');
    });

    it('calls monitor.onUnmappedCC when no rule matches', async () => {
      const deviceDiscovery = createMockDeviceDiscovery(
        [DEVICES, []],
        [false],
      );
      const midiInput = createMockMidiInput();
      const monitor = createMockMonitor();
      const { deps } = createDeps({ deviceDiscovery, midiInput, monitor });

      const app = new MidiMapperApp(deps, 10);
      await app.run('config.yaml', true);

      // CC 99 has no rule in TEST_CONFIG
      midiInput.simulateMessage({ channel: 0, cc: 99, value: 50 });

      expect(monitor.onUnmappedCC).toHaveBeenCalledWith(99, 50);
      expect(monitor.onMidiActivity).not.toHaveBeenCalled();
    });

    it('calls monitor.onMacroActivity when macros fire', async () => {
      const macroConfig: AppConfig = {
        deviceName: 'VirtualOut',
        rules: [
          { cc: 10, label: 'Volume', inputMin: 0, inputMax: 127, outputMin: 0, outputMax: 127, curve: 'linear' as const },
        ],
        macros: [
          {
            input: 10,
            label: 'VolumeMacro',
            outputs: [
              { cc: 20, label: 'Aux1', outputMin: 0, outputMax: 127, curve: 'linear' as const },
            ],
          },
        ],
      };
      const deviceDiscovery = createMockDeviceDiscovery(
        [DEVICES, []],
        [false],
      );
      const midiInput = createMockMidiInput();
      const monitor = createMockMonitor();
      const configReader = createMockConfigReader(macroConfig);
      const { deps } = createDeps({ deviceDiscovery, midiInput, monitor, configReader });

      const app = new MidiMapperApp(deps, 10);
      await app.run('config.yaml', true);

      midiInput.simulateMessage({ channel: 0, cc: 10, value: 64 });

      expect(monitor.onMacroActivity).toHaveBeenCalledWith(10, expect.arrayContaining([
        expect.objectContaining({ cc: 20 }),
      ]));
    });

    it('calls monitor.setDevice after device selection', async () => {
      const deviceDiscovery = createMockDeviceDiscovery(
        [DEVICES, []],
        [false],
      );
      const midiInput = createMockMidiInput();
      const monitor = createMockMonitor();
      const { deps } = createDeps({ deviceDiscovery, midiInput, monitor });

      const app = new MidiMapperApp(deps, 10);
      await app.run('config.yaml', true);

      expect(monitor.setDevice).toHaveBeenCalledWith('Controller A');
    });

    it('calls monitor.setConnectionStatus(false) on disconnect', async () => {
      const deviceDiscovery = createMockDeviceDiscovery(
        [DEVICES, []],
        [false], // immediate disconnect
      );
      const midiInput = createMockMidiInput();
      const monitor = createMockMonitor();
      const { deps } = createDeps({ deviceDiscovery, midiInput, monitor });

      const app = new MidiMapperApp(deps, 10);
      await app.run('config.yaml', true);

      expect(monitor.setConnectionStatus).toHaveBeenCalledWith(false);
    });

    it('works without monitor port (backward compat)', async () => {
      const deviceDiscovery = createMockDeviceDiscovery(
        [DEVICES, []],
        [false],
      );
      const midiInput = createMockMidiInput();
      const midiOutput = createMockMidiOutput();
      const ui = createMockUI(0);
      // No monitor provided
      const { deps } = createDeps({ deviceDiscovery, midiInput, midiOutput, ui });

      const app = new MidiMapperApp(deps, 10);
      await app.run('config.yaml', true);

      // Should still process messages normally
      midiInput.simulateMessage({ channel: 0, cc: 10, value: 64 });
      expect(midiOutput.send).toHaveBeenCalled();
      expect(ui.logMapping).toHaveBeenCalled();
    });

    it('does not call monitor.onMacroActivity when no macros fire', async () => {
      const deviceDiscovery = createMockDeviceDiscovery(
        [DEVICES, []],
        [false],
      );
      const midiInput = createMockMidiInput();
      const monitor = createMockMonitor();
      const { deps } = createDeps({ deviceDiscovery, midiInput, monitor });

      const app = new MidiMapperApp(deps, 10);
      await app.run('config.yaml', true);

      // CC 10 has a rule but no macros in TEST_CONFIG
      midiInput.simulateMessage({ channel: 0, cc: 10, value: 64 });

      expect(monitor.onMacroActivity).not.toHaveBeenCalled();
    });

    it('returns undefined label for unmapped CC', async () => {
      const deviceDiscovery = createMockDeviceDiscovery(
        [DEVICES, []],
        [false],
      );
      const midiInput = createMockMidiInput();
      const monitor = createMockMonitor();
      const { deps } = createDeps({ deviceDiscovery, midiInput, monitor });

      const app = new MidiMapperApp(deps, 10);
      await app.run('config.yaml', true);

      // CC 99 has no rule - onUnmappedCC should be called (no label needed)
      midiInput.simulateMessage({ channel: 0, cc: 99, value: 50 });
      expect(monitor.onUnmappedCC).toHaveBeenCalledWith(99, 50);
    });
  });

  // --- MIDI Learn ---

  describe('MIDI Learn', () => {
    it('intercepts message and feeds CC to config editor service', async () => {
      const deviceDiscovery = createMockDeviceDiscovery(
        [DEVICES, []],
        [false],
      );
      const midiInput = createMockMidiInput();
      const midiOutput = createMockMidiOutput();
      const { deps } = createDeps({ deviceDiscovery, midiInput, midiOutput });

      const mockService = {
        isMidiLearnActive: true,
        feedMidiLearn: mock((_cc: number) => true),
        cancelMidiLearn: mock(() => {}),
      };

      const app = new MidiMapperApp(deps, 10);
      app.setConfigEditorService(mockService);
      await app.run('config.yaml', true);

      midiInput.simulateMessage({ channel: 0, cc: 42, value: 100 });

      expect(mockService.feedMidiLearn).toHaveBeenCalledWith(42);
    });

    it('skips normal processing during MIDI learn', async () => {
      const deviceDiscovery = createMockDeviceDiscovery(
        [DEVICES, []],
        [false],
      );
      const midiInput = createMockMidiInput();
      const midiOutput = createMockMidiOutput();
      const ui = createMockUI(0);
      const { deps } = createDeps({ deviceDiscovery, midiInput, midiOutput, ui });

      const mockService = {
        isMidiLearnActive: true,
        feedMidiLearn: mock((_cc: number) => true),
        cancelMidiLearn: mock(() => {}),
      };

      const app = new MidiMapperApp(deps, 10);
      app.setConfigEditorService(mockService);
      await app.run('config.yaml', true);

      midiInput.simulateMessage({ channel: 0, cc: 10, value: 64 });

      // Normal processing should be skipped
      expect(midiOutput.send).not.toHaveBeenCalled();
      expect(ui.logMapping).not.toHaveBeenCalled();
    });

    it('resumes normal processing after learn completes', async () => {
      const deviceDiscovery = createMockDeviceDiscovery(
        [DEVICES, []],
        [false],
      );
      const midiInput = createMockMidiInput();
      const midiOutput = createMockMidiOutput();
      const ui = createMockUI(0);
      const { deps } = createDeps({ deviceDiscovery, midiInput, midiOutput, ui });

      const mockService = {
        isMidiLearnActive: true,
        feedMidiLearn: mock((_cc: number) => true),
        cancelMidiLearn: mock(() => {}),
      };

      const app = new MidiMapperApp(deps, 10);
      app.setConfigEditorService(mockService);
      await app.run('config.yaml', true);

      // First message: intercepted by MIDI learn
      midiInput.simulateMessage({ channel: 0, cc: 10, value: 64 });
      expect(midiOutput.send).not.toHaveBeenCalled();

      // Deactivate MIDI learn
      mockService.isMidiLearnActive = false;

      // Second message: normal processing resumes
      midiInput.simulateMessage({ channel: 0, cc: 10, value: 64 });
      expect(midiOutput.send).toHaveBeenCalled();
      expect(ui.logMapping).toHaveBeenCalled();
    });
  });

  // --- Hot reload ---

  describe('Hot reload', () => {
    it('uses updated rules after onConfigChanged callback fires', async () => {
      const deviceDiscovery = createMockDeviceDiscovery(
        [DEVICES, []],
        [false],
      );
      const midiInput = createMockMidiInput();
      const midiOutput = createMockMidiOutput();
      const ui = createMockUI(0);
      const { deps } = createDeps({ deviceDiscovery, midiInput, midiOutput, ui });

      const mockService: any = {
        isMidiLearnActive: false,
        feedMidiLearn: mock((_cc: number) => true),
        onConfigChanged: null,
      };

      const app = new MidiMapperApp(deps, 10);
      app.setConfigEditorService(mockService);
      await app.run('config.yaml', true);

      // The app should have registered onConfigChanged
      expect(mockService.onConfigChanged).toBeFunction();

      // Original config: CC 10 has a rule with outputMin=0, outputMax=127 (linear)
      // Send message with old rules
      midiInput.simulateMessage({ channel: 0, cc: 10, value: 64 });
      const firstLogCall = (ui.logMapping as ReturnType<typeof mock>).mock.calls[0];
      const firstMappedValue = firstLogCall[2]; // mappedValue from log

      // Now fire hot-reload with a new config where CC 10 has outputMin=0, outputMax=50
      const newConfig: AppConfig = {
        deviceName: 'VirtualOut',
        rules: [
          { cc: 10, label: 'Volume Low', inputMin: 0, inputMax: 127, outputMin: 0, outputMax: 50, curve: 'linear' as const },
        ],
      };
      mockService.onConfigChanged(newConfig);

      // Send same message again with new rules
      midiInput.simulateMessage({ channel: 0, cc: 10, value: 64 });
      const secondLogCall = (ui.logMapping as ReturnType<typeof mock>).mock.calls[1];
      const secondMappedValue = secondLogCall[2];

      // Mapped value should differ (64 maps to ~25 with max 50 vs 64 with max 127)
      expect(secondMappedValue).not.toBe(firstMappedValue);
      expect(secondMappedValue).toBeLessThan(firstMappedValue);
    });

    it('does not register onConfigChanged when no config editor service', async () => {
      const deviceDiscovery = createMockDeviceDiscovery(
        [DEVICES, []],
        [false],
      );
      const midiInput = createMockMidiInput();
      const { deps } = createDeps({ deviceDiscovery, midiInput });

      // No configEditorService set
      const app = new MidiMapperApp(deps, 10);
      // Should not throw
      await app.run('config.yaml', true);

      // Just verify normal operation works
      midiInput.simulateMessage({ channel: 0, cc: 10, value: 64 });
    });

    it('updates macros on hot-reload as well', async () => {
      const deviceDiscovery = createMockDeviceDiscovery(
        [DEVICES, []],
        [false],
      );
      const midiInput = createMockMidiInput();
      const midiOutput = createMockMidiOutput();
      const monitor = createMockMonitor();
      const { deps } = createDeps({ deviceDiscovery, midiInput, midiOutput, monitor });

      const mockService: any = {
        isMidiLearnActive: false,
        feedMidiLearn: mock((_cc: number) => true),
        onConfigChanged: null,
      };

      const app = new MidiMapperApp(deps, 10);
      app.setConfigEditorService(mockService);
      await app.run('config.yaml', true);

      // Original config has no macros, send CC 10
      midiInput.simulateMessage({ channel: 0, cc: 10, value: 64 });
      expect(monitor.onMacroActivity).not.toHaveBeenCalled();

      // Hot-reload with macros
      const newConfig: AppConfig = {
        deviceName: 'VirtualOut',
        rules: [
          { cc: 10, label: 'Volume', inputMin: 0, inputMax: 127, outputMin: 0, outputMax: 127, curve: 'linear' as const },
        ],
        macros: [
          {
            input: 10,
            label: 'VolumeMacro',
            outputs: [
              { cc: 30, label: 'Aux', outputMin: 0, outputMax: 127, curve: 'linear' as const },
            ],
          },
        ],
      };
      mockService.onConfigChanged(newConfig);

      // Now CC 10 should trigger macro outputs
      midiInput.simulateMessage({ channel: 0, cc: 10, value: 64 });
      expect(monitor.onMacroActivity).toHaveBeenCalledWith(10, expect.arrayContaining([
        expect.objectContaining({ cc: 30 }),
      ]));
    });
  });

  // --- MIDI Learn + Disconnect ---

  describe('MIDI Learn + Disconnect', () => {
    it('cancels MIDI learn on device disconnect', async () => {
      const deviceDiscovery = createMockDeviceDiscovery(
        [DEVICES, []], // first call returns devices, second returns empty to exit loop
        [false],       // immediate disconnect
      );
      const midiInput = createMockMidiInput();
      const midiOutput = createMockMidiOutput();
      const ui = createMockUI(0);
      const { deps } = createDeps({ deviceDiscovery, midiInput, midiOutput, ui });

      const cancelMidiLearn = mock(() => {});
      const mockService = {
        isMidiLearnActive: true,
        feedMidiLearn: mock((_cc: number) => true),
        cancelMidiLearn,
      };

      const app = new MidiMapperApp(deps, 10);
      app.setConfigEditorService(mockService);
      await app.run('config.yaml', true);

      // After disconnect, cancelMidiLearn should have been called
      expect(cancelMidiLearn).toHaveBeenCalled();
    });

    it('does not call cancelMidiLearn when learn is not active on disconnect', async () => {
      const deviceDiscovery = createMockDeviceDiscovery(
        [DEVICES, []], // first call returns devices, second returns empty to exit loop
        [false],       // immediate disconnect
      );
      const midiInput = createMockMidiInput();
      const midiOutput = createMockMidiOutput();
      const ui = createMockUI(0);
      const { deps } = createDeps({ deviceDiscovery, midiInput, midiOutput, ui });

      const cancelMidiLearn = mock(() => {});
      const mockService = {
        isMidiLearnActive: false,
        feedMidiLearn: mock((_cc: number) => false),
        cancelMidiLearn,
      };

      const app = new MidiMapperApp(deps, 10);
      app.setConfigEditorService(mockService);
      await app.run('config.yaml', true);

      // cancelMidiLearn should NOT have been called since learn was not active
      expect(cancelMidiLearn).not.toHaveBeenCalled();
    });
  });
});
