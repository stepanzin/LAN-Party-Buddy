import React from 'react';
import { render } from 'ink';
import type { UserInterfacePort } from '../../ports/user-interface.port';
import type { MonitorPort } from '../../ports/monitor.port';
import type { MidiDevice } from '../../ports/device-discovery.port';
import type { ConfigEditorPort } from '../../ports/config-editor.port';
import { TuiStore } from './tui-store';
import { App } from './app';

export class InkTuiAdapter implements UserInterfacePort, MonitorPort {
  private unmount?: () => void;
  private exitPromise?: Promise<void>;

  constructor(
    private store: TuiStore,
    private configEditor?: ConfigEditorPort,
  ) {}

  // --- MonitorPort ---

  start(): void {
    const { unmount, waitUntilExit } = render(
      React.createElement(App, {
        store: this.store,
        configEditor: this.configEditor,
      }),
    );
    this.unmount = unmount;
    this.exitPromise = waitUntilExit();
  }

  /** Resolves when user quits the TUI (via Q or useApp().exit()) */
  waitForExit(): Promise<void> {
    return this.exitPromise ?? Promise.resolve();
  }

  stop(): void {
    this.unmount?.();
  }

  onMidiActivity(cc: number, value: number, mappedValue: number, ruleLabel?: string): void {
    this.store.pushActivity({
      cc, value, mappedValue, ruleLabel,
      timestamp: Date.now(),
    });
    this.store.pushLog({
      timestamp: Date.now(),
      cc,
      originalValue: value,
      mappedValue,
      ruleLabel,
      matched: true,
    });
  }

  onMacroActivity(inputCc: number, outputs: Array<{ cc: number; value: number }>): void {
    this.store.pushMacroActivity({
      inputCc, outputs,
      timestamp: Date.now(),
    });
  }

  onUnmappedCC(cc: number, value: number): void {
    this.store.pushUnmapped(cc, value);
    this.store.pushLog({
      timestamp: Date.now(),
      cc,
      originalValue: value,
      mappedValue: value,
      matched: false,
    });
  }

  setDevice(name: string): void {
    this.store.setDevice(name);
  }

  setConnectionStatus(connected: boolean): void {
    this.store.setConnectionStatus(connected);
  }

  // --- UserInterfacePort ---

  async selectDevice(devices: MidiDevice[]): Promise<number> {
    return new Promise<number>((resolve) => {
      this.store.setDeviceSelection(
        devices,
        (index: number) => resolve(index),
      );
    });
  }

  showInfo(message: string): void {
    this.store.setSystemMessage(message);
  }

  showWarning(message: string): void {
    this.store.setSystemMessage(message);
  }

  showError(message: string): void {
    this.store.setSystemMessage(message);
  }

  logMapping(cc: number, originalValue: number, mappedValue: number): void {
    // Already handled by onMidiActivity → pushLog
  }
}
