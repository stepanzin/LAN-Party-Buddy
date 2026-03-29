import { describe, it, expect, mock } from 'bun:test';
import { ConfigEditorService } from '../../src/app/config-editor.service';
import type { ConfigWriterPort } from '../../src/ports/config-writer.port';
import type { AppConfig, RuleConfig, MacroConfig } from '../../src/domain/config';

const makeRule = (cc: number, label = `CC${cc}`): RuleConfig => ({
  cc,
  label,
  inputMin: 0,
  inputMax: 127,
  outputMin: 0,
  outputMax: 127,
  curve: 'linear',
});

const makeMacro = (input: number, label = `Macro${input}`): MacroConfig => ({
  input,
  label,
  outputs: [{ cc: input + 10, label: `Out${input}`, outputMin: 0, outputMax: 127, curve: 'linear' }],
});

const makeConfig = (overrides?: Partial<AppConfig>): AppConfig => ({
  deviceName: 'Test Device',
  rules: [makeRule(1), makeRule(2)],
  ...overrides,
});

const makeWriter = (): ConfigWriterPort => ({
  save: mock(() => Promise.resolve()),
});

describe('ConfigEditorService', () => {
  // --- getConfig ---

  it('getConfig returns current config', () => {
    const config = makeConfig();
    const svc = new ConfigEditorService(config, makeWriter());
    expect(svc.getConfig()).toBe(config);
  });

  // --- updateRule ---

  it('updateRule modifies config and calls onConfigChanged', () => {
    const config = makeConfig();
    const svc = new ConfigEditorService(config, makeWriter());
    const changed = mock(() => {});
    svc.onConfigChanged = changed;

    const newRule = makeRule(99, 'Updated');
    svc.updateRule(0, newRule);

    expect(svc.getConfig().rules[0]).toEqual(newRule);
    expect(svc.getConfig().rules[1]).toEqual(makeRule(2));
    expect(changed).toHaveBeenCalledTimes(1);
    expect(changed).toHaveBeenCalledWith(svc.getConfig());
  });

  // --- addRule ---

  it('addRule appends and calls callback', () => {
    const config = makeConfig();
    const svc = new ConfigEditorService(config, makeWriter());
    const changed = mock(() => {});
    svc.onConfigChanged = changed;

    const newRule = makeRule(50);
    svc.addRule(newRule);

    expect(svc.getConfig().rules).toHaveLength(3);
    expect(svc.getConfig().rules[2]).toEqual(newRule);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(changed).toHaveBeenCalledWith(svc.getConfig());
  });

  // --- deleteRule ---

  it('deleteRule removes and calls callback', () => {
    const config = makeConfig();
    const svc = new ConfigEditorService(config, makeWriter());
    const changed = mock(() => {});
    svc.onConfigChanged = changed;

    svc.deleteRule(0);

    expect(svc.getConfig().rules).toHaveLength(1);
    expect(svc.getConfig().rules[0]).toEqual(makeRule(2));
    expect(changed).toHaveBeenCalledTimes(1);
    expect(changed).toHaveBeenCalledWith(svc.getConfig());
  });

  // --- updateMacro ---

  it('updateMacro modifies config and calls onConfigChanged', () => {
    const config = makeConfig({ macros: [makeMacro(10), makeMacro(20)] });
    const svc = new ConfigEditorService(config, makeWriter());
    const changed = mock(() => {});
    svc.onConfigChanged = changed;

    const newMacro = makeMacro(99);
    svc.updateMacro(0, newMacro);

    expect(svc.getConfig().macros![0]).toEqual(newMacro);
    expect(svc.getConfig().macros![1]).toEqual(makeMacro(20));
    expect(changed).toHaveBeenCalledTimes(1);
  });

  // --- addMacro ---

  it('addMacro appends and calls callback', () => {
    const config = makeConfig({ macros: [makeMacro(10)] });
    const svc = new ConfigEditorService(config, makeWriter());
    const changed = mock(() => {});
    svc.onConfigChanged = changed;

    const newMacro = makeMacro(30);
    svc.addMacro(newMacro);

    expect(svc.getConfig().macros).toHaveLength(2);
    expect(svc.getConfig().macros![1]).toEqual(newMacro);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('addMacro works when macros is undefined', () => {
    const config = makeConfig(); // no macros field
    const svc = new ConfigEditorService(config, makeWriter());
    const changed = mock(() => {});
    svc.onConfigChanged = changed;

    const newMacro = makeMacro(10);
    svc.addMacro(newMacro);

    expect(svc.getConfig().macros).toHaveLength(1);
    expect(svc.getConfig().macros![0]).toEqual(newMacro);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  // --- deleteMacro ---

  it('deleteMacro removes and calls callback', () => {
    const config = makeConfig({ macros: [makeMacro(10), makeMacro(20)] });
    const svc = new ConfigEditorService(config, makeWriter());
    const changed = mock(() => {});
    svc.onConfigChanged = changed;

    svc.deleteMacro(0);

    expect(svc.getConfig().macros).toHaveLength(1);
    expect(svc.getConfig().macros![0]).toEqual(makeMacro(20));
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('deleteMacro works when macros is undefined', () => {
    const config = makeConfig(); // no macros field
    const svc = new ConfigEditorService(config, makeWriter());
    const changed = mock(() => {});
    svc.onConfigChanged = changed;

    svc.deleteMacro(0);

    expect(svc.getConfig().macros).toEqual([]);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  // --- MIDI learn ---

  it('startMidiLearn returns promise, feedMidiLearn resolves it', async () => {
    const svc = new ConfigEditorService(makeConfig(), makeWriter());

    const promise = svc.startMidiLearn();
    expect(svc.isMidiLearnActive).toBe(true);

    svc.feedMidiLearn(42);

    const cc = await promise;
    expect(cc).toBe(42);
    expect(svc.isMidiLearnActive).toBe(false);
  });

  it('cancelMidiLearn rejects the promise', async () => {
    const svc = new ConfigEditorService(makeConfig(), makeWriter());

    const promise = svc.startMidiLearn();
    expect(svc.isMidiLearnActive).toBe(true);

    svc.cancelMidiLearn();
    expect(svc.isMidiLearnActive).toBe(false);

    await expect(promise).rejects.toBeUndefined();
  });

  it('isMidiLearnActive tracks state', () => {
    const svc = new ConfigEditorService(makeConfig(), makeWriter());

    expect(svc.isMidiLearnActive).toBe(false);

    svc.startMidiLearn().catch(() => {}); // ignore rejection on cancel
    expect(svc.isMidiLearnActive).toBe(true);

    svc.cancelMidiLearn();
    expect(svc.isMidiLearnActive).toBe(false);
  });

  it('feedMidiLearn returns false when not in learn mode', () => {
    const svc = new ConfigEditorService(makeConfig(), makeWriter());

    expect(svc.feedMidiLearn(10)).toBe(false);
  });

  it('feedMidiLearn returns true when in learn mode', async () => {
    const svc = new ConfigEditorService(makeConfig(), makeWriter());

    const promise = svc.startMidiLearn();
    const fed = svc.feedMidiLearn(10);

    expect(fed).toBe(true);
    await promise; // ensure it resolves
  });

  it('startMidiLearn cancels any existing learn before starting new one', async () => {
    const svc = new ConfigEditorService(makeConfig(), makeWriter());

    const first = svc.startMidiLearn();
    const second = svc.startMidiLearn();

    // First should have been rejected
    await expect(first).rejects.toBeUndefined();

    // Second should still be active
    expect(svc.isMidiLearnActive).toBe(true);

    svc.feedMidiLearn(55);
    const cc = await second;
    expect(cc).toBe(55);
  });

  // --- saveConfig ---

  it('saveConfig delegates to writer', async () => {
    const writer = makeWriter();
    const config = makeConfig();
    const svc = new ConfigEditorService(config, writer);

    await svc.saveConfig('/tmp/test.yaml');

    expect(writer.save).toHaveBeenCalledTimes(1);
    expect(writer.save).toHaveBeenCalledWith('/tmp/test.yaml', config);
  });

  // --- onConfigChanged not set ---

  it('does not throw when onConfigChanged is null', () => {
    const svc = new ConfigEditorService(makeConfig(), makeWriter());
    // onConfigChanged is null by default, should not throw
    expect(() => svc.addRule(makeRule(99))).not.toThrow();
  });
});
