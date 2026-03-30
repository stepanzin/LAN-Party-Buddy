import type { AppConfig, MacroConfig, RuleConfig } from '@domain/config';

export interface ConfigEditorPort {
  getConfig(): AppConfig;

  startMidiLearn(): Promise<number>;
  cancelMidiLearn(): void;

  updateRule(index: number, rule: RuleConfig): void;
  addRule(rule: RuleConfig): void;
  deleteRule(index: number): void;

  updateMacro(index: number, macro: MacroConfig): void;
  addMacro(macro: MacroConfig): void;
  deleteMacro(index: number): void;

  updateDeviceName(name: string): void;

  saveConfig(path: string): Promise<void>;
}
