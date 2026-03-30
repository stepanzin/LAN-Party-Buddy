import type { ConfigEditorPort } from '@ports/config-editor.port';
import type { ConfigWriterPort } from '@ports/config-writer.port';
import type { AppConfig, RuleConfig, MacroConfig } from '@domain/config';

export class ConfigEditorService implements ConfigEditorPort {
  private config: AppConfig;
  private configWriter: ConfigWriterPort;

  // MIDI learn state
  private midiLearnResolver: ((cc: number) => void) | null = null;
  private midiLearnRejecter: (() => void) | null = null;

  // Callback for app to register
  public onConfigChanged: ((config: AppConfig) => void) | null = null;

  constructor(config: AppConfig, configWriter: ConfigWriterPort) {
    this.config = config;
    this.configWriter = configWriter;
  }

  getConfig(): AppConfig { return this.config; }

  startMidiLearn(): Promise<number> {
    this.cancelMidiLearn(); // cancel any existing
    return new Promise((resolve, reject) => {
      this.midiLearnResolver = resolve;
      this.midiLearnRejecter = reject;
    });
  }

  cancelMidiLearn(): void {
    if (this.midiLearnRejecter) {
      this.midiLearnRejecter();
    }
    this.midiLearnResolver = null;
    this.midiLearnRejecter = null;
  }

  // Called by MidiMapperApp when a MIDI message arrives during learn mode
  feedMidiLearn(cc: number): boolean {
    if (this.midiLearnResolver) {
      this.midiLearnResolver(cc);
      this.midiLearnResolver = null;
      this.midiLearnRejecter = null;
      return true;
    }
    return false;
  }

  get isMidiLearnActive(): boolean {
    return this.midiLearnResolver !== null;
  }

  updateRule(index: number, rule: RuleConfig): void {
    const rules = [...this.config.rules];
    rules[index] = rule;
    this.config = { ...this.config, rules };
    this.onConfigChanged?.(this.config);
  }

  addRule(rule: RuleConfig): void {
    this.config = { ...this.config, rules: [...this.config.rules, rule] };
    this.onConfigChanged?.(this.config);
  }

  deleteRule(index: number): void {
    const rules = this.config.rules.filter((_, i) => i !== index);
    this.config = { ...this.config, rules };
    this.onConfigChanged?.(this.config);
  }

  updateMacro(index: number, macro: MacroConfig): void {
    const macros = [...(this.config.macros ?? [])];
    macros[index] = macro;
    this.config = { ...this.config, macros };
    this.onConfigChanged?.(this.config);
  }

  addMacro(macro: MacroConfig): void {
    this.config = { ...this.config, macros: [...(this.config.macros ?? []), macro] };
    this.onConfigChanged?.(this.config);
  }

  deleteMacro(index: number): void {
    const macros = (this.config.macros ?? []).filter((_, i) => i !== index);
    this.config = { ...this.config, macros };
    this.onConfigChanged?.(this.config);
  }

  updateDeviceName(name: string): void {
    this.config = { ...this.config, deviceName: name };
    this.onConfigChanged?.(this.config);
  }

  async saveConfig(path: string): Promise<void> {
    await this.configWriter.save(path, this.config);
  }
}
