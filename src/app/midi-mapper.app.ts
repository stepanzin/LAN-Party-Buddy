import type { MidiInputPort } from '../ports/midi-input.port.ts';
import type { MidiOutputPort } from '../ports/midi-output.port.ts';
import type { DeviceDiscoveryPort } from '../ports/device-discovery.port.ts';
import type { UserInterfacePort } from '../ports/user-interface.port.ts';
import type { ConfigReaderPort } from '../ports/config-reader.port.ts';
import type { StateStorePort } from '../ports/state-store.port.ts';
import type { CompiledRules, CompiledMacros } from '../domain/mapping-rule.ts';
import { buildRules, buildMacros } from './rule-compiler.ts';
import { processMidiMessage, INITIAL_ENGINE_STATE, type EngineState } from '../domain/mapping-engine.ts';
import type { MidiCC } from '../domain/midi-message.ts';

export type MidiMapperDeps = {
  readonly midiInput: MidiInputPort;
  readonly midiOutput: MidiOutputPort;
  readonly deviceDiscovery: DeviceDiscoveryPort;
  readonly ui: UserInterfacePort;
  readonly configReader: ConfigReaderPort;
  readonly stateStore: StateStorePort;
};

export class MidiMapperApp {
  constructor(
    private deps: MidiMapperDeps,
    private pollIntervalMs = 2000,
  ) {}

  async run(configSource: string): Promise<void> {
    const config = await this.deps.configReader.load(configSource);
    const rules = buildRules(config);
    const macros = buildMacros(config);
    await this.deviceLoop(config.deviceName, rules, macros);
  }

  private async deviceLoop(deviceName: string, rules: CompiledRules, macros: CompiledMacros): Promise<void> {
    while (true) {
      const devices = this.deps.deviceDiscovery.listDevices();
      if (devices.length === 0) {
        this.deps.ui.showError('No MIDI input devices found. Connect a device and try again.');
        return;
      }

      const state = await this.deps.stateStore.load();
      let deviceIndex: number | undefined;

      if (state.lastDevice) {
        const match = devices.find(d => d.name === state.lastDevice);
        if (match) {
          deviceIndex = match.index;
          this.deps.ui.showInfo(`Auto-connecting to last device: ${state.lastDevice}`);
        } else {
          this.deps.ui.showInfo(`Last device "${state.lastDevice}" not found.`);
        }
      }

      if (deviceIndex === undefined) {
        deviceIndex = await this.deps.ui.selectDevice(devices);
      }

      const selectedDevice = devices.find(d => d.index === deviceIndex)!;

      this.deps.midiInput.open(deviceIndex);
      this.deps.midiOutput.openVirtual(deviceName);

      await this.deps.stateStore.save({ lastDevice: selectedDevice.name });
      this.deps.ui.showInfo(`Proxying MIDI signals -> ${deviceName}\nDevice: ${selectedDevice.name}`);

      let engineState: EngineState = INITIAL_ENGINE_STATE;
      this.deps.midiInput.onMessage((msg: MidiCC) => {
        const { result, nextState } = processMidiMessage(msg, rules, macros, engineState);
        engineState = nextState;
        for (const outMsg of result.outputMessages) {
          this.deps.midiOutput.send(outMsg);
        }
        this.deps.ui.logMapping(result.log.cc, result.log.originalValue, result.log.mappedValue);
      });

      this.deps.midiInput.onError((err) => {
        this.deps.ui.showError(`MIDI input error: ${err.message}`);
      });

      const disconnected = await this.waitForDisconnect(selectedDevice.name);
      if (disconnected) {
        this.deps.ui.showWarning(`Device "${selectedDevice.name}" disconnected.`);
        this.deps.midiInput.close();
        this.deps.midiOutput.close();
      }
    }
  }

  private waitForDisconnect(deviceName: string): Promise<boolean> {
    return new Promise((resolve) => {
      const poll = setInterval(() => {
        if (!this.deps.deviceDiscovery.isDeviceConnected(deviceName)) {
          clearInterval(poll);
          resolve(true);
        }
      }, this.pollIntervalMs);
    });
  }
}
