import type { AppMode } from '@domain/config';
import type { ConfigEditorPort } from '@ports/config-editor.port';
import type { MidiDevice } from '@ports/device-discovery.port';
import type { MonitorPort } from '@ports/monitor.port';
import type { UserInterfacePort } from '@ports/user-interface.port';
import { render } from 'ink';
import React from 'react';
import { App } from './app';
import { WelcomeScreen } from './components/welcome-screen';
import type { TuiStore } from './tui-store';

export class InkTuiAdapter implements UserInterfacePort, MonitorPort {
  private unmount?: () => void;
  private exitPromise?: Promise<void>;

  constructor(
    private store: TuiStore,
    private configEditor?: ConfigEditorPort,
  ) {}

  // --- Lifecycle ---

  start(): void {
    // Clear terminal and use alternate screen buffer for clean TUI
    process.stdout.write('\x1b[2J\x1b[H');

    const { unmount, waitUntilExit } = render(
      React.createElement(App, {
        store: this.store,
        configEditor: this.configEditor,
      }),
    );
    this.unmount = unmount;
    this.exitPromise = waitUntilExit();
  }

  stop(): void {
    this.unmount?.();
  }

  waitForExit(): Promise<void> {
    return this.exitPromise ?? Promise.resolve();
  }

  // --- First-run ---

  showWelcome(): Promise<AppMode> {
    return new Promise((resolveChoice) => {
      const { unmount } = render(
        React.createElement(WelcomeScreen, {
          onSelect: (choice: AppMode) => {
            unmount();
            // Clear terminal after welcome screen
            process.stdout.write('\x1b[2J\x1b[H');
            resolveChoice(choice);
          },
        }),
      );
    });
  }

  // --- MonitorPort ---

  onMidiActivity(cc: number, value: number, mappedValue: number, ruleLabel?: string): void {
    this.store.pushActivity({
      cc,
      value,
      mappedValue,
      ruleLabel,
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
      inputCc,
      outputs,
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
      this.store.setDeviceSelection(devices, (index: number) => resolve(index));
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

  logMapping(_cc: number, _originalValue: number, _mappedValue: number): void {
    // Already handled by onMidiActivity → pushLog
  }
}
