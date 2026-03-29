import type { MidiInputPort } from '../ports/midi-input.port.ts';
import type { MidiOutputPort } from '../ports/midi-output.port.ts';
import type { DeviceDiscoveryPort } from '../ports/device-discovery.port.ts';
import type { UserInterfacePort } from '../ports/user-interface.port.ts';
import type { ConfigReaderPort } from '../ports/config-reader.port.ts';
import type { StateStorePort } from '../ports/state-store.port.ts';
import type { MonitorPort } from '../ports/monitor.port.ts';
import type { ConfigEditorPort } from '../ports/config-editor.port.ts';
import type { CompiledRules, CompiledMacros } from '../domain/mapping-rule.ts';
import type { AppConfig } from '../domain/config.ts';
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
  readonly monitor?: MonitorPort;
  readonly configEditor?: ConfigEditorPort;
};

export class MidiMapperApp {
  private configEditorService?: { isMidiLearnActive: boolean; feedMidiLearn(cc: number): boolean; cancelMidiLearn(): void };
  private currentConfig?: AppConfig;

  constructor(
    private deps: MidiMapperDeps,
    private pollIntervalMs = 2000,
  ) {}

  setConfigEditorService(service: { isMidiLearnActive: boolean; feedMidiLearn(cc: number): boolean; cancelMidiLearn(): void }): void {
    this.configEditorService = service;
  }

  async run(configSource: string): Promise<void> {
    const config = await this.deps.configReader.load(configSource);
    this.currentConfig = config;
    let rules = buildRules(config);
    let macros = buildMacros(config);

    let currentDeviceName = config.deviceName;

    // Register hot-reload callback if config editor service exists
    if (this.configEditorService) {
      const existing = (this.configEditorService as any).onConfigChanged as ((c: AppConfig) => void) | null;
      (this.configEditorService as any).onConfigChanged = (newConfig: AppConfig) => {
        this.currentConfig = newConfig;
        rules = buildRules(newConfig);
        macros = buildMacros(newConfig);

        // Recreate virtual port if deviceName changed
        if (newConfig.deviceName !== currentDeviceName) {
          currentDeviceName = newConfig.deviceName;
          try {
            this.deps.midiOutput.close();
            this.deps.midiOutput.openVirtual(currentDeviceName);
            this.deps.monitor?.setDevice(currentDeviceName);
          } catch {}
        }

        existing?.(newConfig);
      };
    }

    await this.deviceLoop(currentDeviceName, () => rules, () => macros);
  }

  private async deviceLoop(
    deviceName: string,
    getRules: () => CompiledRules,
    getMacros: () => CompiledMacros,
  ): Promise<void> {
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

      // Notify monitor of device selection
      this.deps.monitor?.setDevice(selectedDevice.name);

      let engineState: EngineState = INITIAL_ENGINE_STATE;
      this.deps.midiInput.onMessage((msg: MidiCC) => {
        // MIDI Learn: intercept next message
        if (this.configEditorService?.isMidiLearnActive) {
          this.configEditorService.feedMidiLearn(msg.cc);
          return; // skip normal processing
        }

        const { result, nextState } = processMidiMessage(msg, getRules(), getMacros(), engineState);
        engineState = nextState;

        for (const outMsg of result.outputMessages) {
          this.deps.midiOutput.send(outMsg);
        }

        this.deps.ui.logMapping(result.log.cc, result.log.originalValue, result.log.mappedValue);

        // Push to monitor
        if (this.deps.monitor) {
          const matched = (result.log as any).matched ?? (getRules()[msg.cc.toString()] !== undefined);
          const macroOutputs: ReadonlyArray<{ readonly cc: number; readonly value: number }> =
            (result.log as any).macroOutputs ?? [];
          const ruleLabel = this.findRuleLabel(msg.cc);

          if (matched) {
            this.deps.monitor.onMidiActivity(msg.cc, msg.value, result.log.mappedValue, ruleLabel);
          } else {
            this.deps.monitor.onUnmappedCC(msg.cc, msg.value);
          }

          if (macroOutputs.length > 0) {
            this.deps.monitor.onMacroActivity(msg.cc, [...macroOutputs]);
          }
        }
      });

      this.deps.midiInput.onError((err) => {
        this.deps.ui.showError(`MIDI input error: ${err.message}`);
      });

      const disconnected = await this.waitForDisconnect(selectedDevice.name);
      if (disconnected) {
        this.deps.ui.showWarning(`Device "${selectedDevice.name}" disconnected.`);
        this.deps.monitor?.setConnectionStatus(false);
        // Cancel any active MIDI learn so the UI doesn't stay stuck
        if (this.configEditorService?.isMidiLearnActive) {
          this.configEditorService.cancelMidiLearn();
        }
        this.deps.midiInput.close();
        this.deps.midiOutput.close();
      }
    }
  }

  private findRuleLabel(cc: number): string | undefined {
    if (!this.currentConfig) return undefined;
    const rule = this.currentConfig.rules.find(r => r.cc === cc);
    return rule?.label;
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
