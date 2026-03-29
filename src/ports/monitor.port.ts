export interface MonitorPort {
  start(): void;
  stop(): void;

  onMidiActivity(cc: number, value: number, mappedValue: number, ruleLabel?: string): void;
  onMacroActivity(inputCc: number, outputs: Array<{ cc: number; value: number }>): void;
  onUnmappedCC(cc: number, value: number): void;

  setDevice(name: string): void;
  setConnectionStatus(connected: boolean): void;
}
