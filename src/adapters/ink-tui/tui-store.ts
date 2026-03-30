import { EventEmitter } from 'node:events';
import type { AppConfig } from '../../domain/config';
import type { MidiDevice } from '../../ports/device-discovery.port';

export type ActivityEntry = {
  readonly cc: number;
  readonly value: number;
  readonly mappedValue: number;
  readonly ruleLabel?: string;
  readonly timestamp: number;
};

export type MacroActivityEntry = {
  readonly inputCc: number;
  readonly outputs: ReadonlyArray<{ readonly cc: number; readonly value: number }>;
  readonly timestamp: number;
};

export type UnmappedEntry = {
  readonly cc: number;
  readonly value: number;
  readonly lastSeen: number;
};

export type LogEntry = {
  readonly timestamp: number;
  readonly cc: number;
  readonly originalValue: number;
  readonly mappedValue: number;
  readonly ruleLabel?: string;
  readonly matched: boolean;
  readonly macroOutputs?: ReadonlyArray<{ readonly cc: number; readonly value: number }>;
};

export type TuiTab = 'monitor' | 'editor' | 'log' | 'settings';

export type TuiState = {
  tab: TuiTab;
  device: string | null;
  connected: boolean;
  messageCount: number;
  startTime: number;

  // Network mode
  mode: 'local' | 'host' | 'join';

  // Host mode
  hostPort: number | null;
  hostPin: string | null;
  hostAccessMode: 'open' | 'pin';
  connectedClients: Array<{ id: string; address: string; connectedAt: number }>;

  // Join mode
  connectedHost: { name: string; address: string; port: number } | null;

  // Monitor
  activities: ActivityEntry[];        // ring buffer, max 20
  macroActivities: MacroActivityEntry[];
  unmapped: Map<number, UnmappedEntry>;

  // Editor
  config: AppConfig | null;
  selectedRuleIndex: number;
  selectedMacroIndex: number;
  midiLearnActive: boolean;
  midiLearnCaptured: number | null;

  // Log
  logEntries: LogEntry[];             // ring buffer, max 200

  // Save feedback
  saveStatus: string | null;

  // System messages
  systemMessage: string | null;

  // Device selection
  deviceSelectionDevices: MidiDevice[] | null;
  deviceSelectionResolver: ((index: number) => void) | null;
};

export class TuiStore extends EventEmitter {
  private state: TuiState;

  constructor() {
    super();
    this.state = {
      tab: 'monitor',
      device: null,
      connected: false,
      messageCount: 0,
      startTime: Date.now(),
      mode: 'local',
      hostPort: null,
      hostPin: null,
      hostAccessMode: 'open',
      connectedClients: [],
      connectedHost: null,
      activities: [],
      macroActivities: [],
      unmapped: new Map(),
      config: null,
      selectedRuleIndex: 0,
      selectedMacroIndex: 0,
      midiLearnActive: false,
      midiLearnCaptured: null,
      logEntries: [],
      saveStatus: null,
      systemMessage: null,
      deviceSelectionDevices: null,
      deviceSelectionResolver: null,
    };
  }

  getState(): Readonly<TuiState> {
    return this.state;
  }

  // Subscribe for React
  subscribe(listener: () => void): () => void {
    this.on('change', listener);
    return () => this.off('change', listener);
  }

  private update(partial: Partial<TuiState>): void {
    this.state = { ...this.state, ...partial };
    this.emit('change');
  }

  // Tab
  setTab(tab: TuiTab): void {
    this.update({ tab });
  }

  // Monitor
  pushActivity(entry: ActivityEntry): void {
    const activities = [...this.state.activities, entry].slice(-20);
    this.update({ activities, messageCount: this.state.messageCount + 1 });
  }

  pushMacroActivity(entry: MacroActivityEntry): void {
    const macroActivities = [...this.state.macroActivities, entry].slice(-10);
    this.update({ macroActivities });
  }

  pushUnmapped(cc: number, value: number): void {
    const unmapped = new Map(this.state.unmapped);
    unmapped.set(cc, { cc, value, lastSeen: Date.now() });
    // Cap at 20 — remove oldest entries
    if (unmapped.size > 20) {
      const sorted = [...unmapped.entries()].sort((a, b) => a[1].lastSeen - b[1].lastSeen);
      while (sorted.length > 20) {
        const oldest = sorted.shift()!;
        unmapped.delete(oldest[0]);
      }
    }
    this.update({ unmapped });
  }

  // Connection
  setDevice(name: string): void {
    this.update({ device: name, connected: true });
  }

  setConnectionStatus(connected: boolean): void {
    this.update({ connected });
  }

  // Config
  setConfig(config: AppConfig): void {
    this.update({ config });
  }

  setSelectedRuleIndex(index: number): void {
    this.update({ selectedRuleIndex: index });
  }

  setSelectedMacroIndex(index: number): void {
    this.update({ selectedMacroIndex: index });
  }

  setMidiLearnActive(active: boolean): void {
    this.update({ midiLearnActive: active, midiLearnCaptured: active ? null : this.state.midiLearnCaptured });
  }

  setMidiLearnCaptured(cc: number): void {
    this.update({ midiLearnActive: false, midiLearnCaptured: cc });
  }

  // Log
  pushLog(entry: LogEntry): void {
    const logEntries = [...this.state.logEntries, entry].slice(-200);
    this.update({ logEntries });
  }

  clearLog(): void {
    this.update({ logEntries: [] });
  }

  setSaveStatus(status: string | null): void {
    this.update({ saveStatus: status });
    if (status) {
      setTimeout(() => this.update({ saveStatus: null }), 2000);
    }
  }

  setSystemMessage(message: string | null): void {
    this.update({ systemMessage: message });
  }

  // Device selection
  setDeviceSelection(devices: MidiDevice[], resolver: (index: number) => void): void {
    this.update({ deviceSelectionDevices: devices, deviceSelectionResolver: resolver });
  }

  resolveDeviceSelection(index: number): void {
    this.state.deviceSelectionResolver?.(index);
    this.update({ deviceSelectionDevices: null, deviceSelectionResolver: null });
  }

  // Network mode
  setMode(mode: 'local' | 'host' | 'join'): void {
    this.update({ mode });
  }

  setHostInfo(port: number, pin: string | null, accessMode: 'open' | 'pin'): void {
    this.update({ hostPort: port, hostPin: pin, hostAccessMode: accessMode });
  }

  addClient(client: { id: string; address: string }): void {
    const connectedClients = [
      ...this.state.connectedClients,
      { ...client, connectedAt: Date.now() },
    ];
    this.update({ connectedClients });
  }

  removeClient(clientId: string): void {
    const connectedClients = this.state.connectedClients.filter(c => c.id !== clientId);
    this.update({ connectedClients });
  }

  setConnectedHost(host: { name: string; address: string; port: number } | null): void {
    this.update({ connectedHost: host });
  }
}
