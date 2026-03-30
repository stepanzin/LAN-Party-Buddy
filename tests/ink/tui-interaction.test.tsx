import { describe, expect, it, mock } from 'bun:test';
import { App } from '@adapters/ink-tui/app';
import { TuiStore } from '@adapters/ink-tui/tui-store';
import type { AppConfig } from '@domain/config';
import type { ConfigEditorPort } from '@ports/config-editor.port';
import { render } from 'ink-testing-library';
import React from 'react';

const TEST_CONFIG: AppConfig = {
  deviceName: 'Test Output',
  rules: [
    { cc: 4, label: 'Expression', inputMin: 0, inputMax: 127, outputMin: 0, outputMax: 127, curve: 'linear' },
    {
      cc: 64,
      label: 'Sustain',
      inputMin: 0,
      inputMax: 127,
      outputMin: 0,
      outputMax: 127,
      curve: 'linear',
      mode: 'toggle',
    },
  ],
};

function renderApp(storeOverrides?: Partial<{ config: AppConfig; systemMessage: string }>) {
  const store = new TuiStore();
  store.setConfig(storeOverrides?.config ?? TEST_CONFIG);
  if (storeOverrides?.systemMessage) {
    store.setSystemMessage(storeOverrides.systemMessage);
  }

  const { lastFrame, stdin, unmount } = render(React.createElement(App, { store }));

  return { store, lastFrame, stdin, unmount };
}

// Helper: wait for Ink to process state update
const tick = () => new Promise((r) => setTimeout(r, 30));

describe('TUI Interaction: ink-testing-library', () => {
  // -----------------------------------------------------------------------
  // Tab switching
  // -----------------------------------------------------------------------

  describe('tab switching', () => {
    it('starts on Monitor tab', () => {
      const { lastFrame, unmount } = renderApp();
      expect(lastFrame()).toContain('[1] Monitor');
      unmount();
    });

    it('switches to Editor tab on pressing "2"', async () => {
      const { lastFrame, stdin, unmount } = renderApp();
      stdin.write('2');
      await tick();
      expect(lastFrame()).toContain('[2] Editor');
      unmount();
    });

    it('switches to Log tab on pressing "3"', async () => {
      const { lastFrame, stdin, unmount } = renderApp();
      stdin.write('3');
      await tick();
      expect(lastFrame()).toContain('[3] Log');
      unmount();
    });

    it('switches back to Monitor on pressing "1"', async () => {
      const { lastFrame, stdin, unmount } = renderApp();
      stdin.write('2');
      await tick();
      expect(lastFrame()).toContain('[2] Editor');
      stdin.write('1');
      await tick();
      expect(lastFrame()).toContain('[1] Monitor');
      unmount();
    });

    it('cycles tabs forward with Tab key', async () => {
      const { lastFrame, stdin, unmount } = renderApp();
      // Monitor → Editor
      stdin.write('\t');
      await tick();
      expect(lastFrame()).toContain('[2] Editor');
      // Editor → Log
      stdin.write('\t');
      await tick();
      expect(lastFrame()).toContain('[3] Log');
      // Log → Settings
      stdin.write('\t');
      await tick();
      expect(lastFrame()).toContain('[4] Settings');
      // Settings → Monitor (wrap)
      stdin.write('\t');
      await tick();
      expect(lastFrame()).toContain('[1] Monitor');
      unmount();
    });

    it('switches to Settings tab on pressing "4"', async () => {
      const { lastFrame, stdin, unmount } = renderApp();
      stdin.write('4');
      await tick();
      expect(lastFrame()).toContain('[4] Settings');
      expect(lastFrame()).toContain('Virtual MIDI Port');
      unmount();
    });
  });

  // -----------------------------------------------------------------------
  // Tab switching WITH system message (no devices scenario)
  // -----------------------------------------------------------------------

  describe('tab switching with system error (no devices)', () => {
    it('shows system error message', () => {
      const { lastFrame, unmount } = renderApp({
        systemMessage: 'No MIDI input devices found.',
      });
      expect(lastFrame()).toContain('No MIDI input devices found.');
      unmount();
    });

    it('tabs still work when system error is displayed', async () => {
      const { lastFrame, stdin, unmount } = renderApp({
        systemMessage: 'No MIDI input devices found.',
      });
      expect(lastFrame()).toContain('[1] Monitor');
      expect(lastFrame()).toContain('No MIDI input devices found.');

      stdin.write('2');
      await tick();
      expect(lastFrame()).toContain('[2] Editor');
      // Error still visible
      expect(lastFrame()).toContain('No MIDI input devices found.');

      stdin.write('3');
      await tick();
      expect(lastFrame()).toContain('[3] Log');

      unmount();
    });
  });

  // -----------------------------------------------------------------------
  // Log tab
  // -----------------------------------------------------------------------

  describe('log tab', () => {
    it('clears log on pressing C', async () => {
      const { store, lastFrame, stdin, unmount } = renderApp();
      // Push some log entries
      store.pushLog({ timestamp: Date.now(), cc: 4, originalValue: 64, mappedValue: 64, matched: true });
      await tick();
      stdin.write('3'); // switch to log tab
      await tick();
      expect(lastFrame()).toContain('64');
      // Press C to clear
      stdin.write('c');
      await tick();
      expect(lastFrame()).not.toContain('64');
      // Should show empty state
      expect(lastFrame()).toContain('No MIDI messages');
      unmount();
    });

    it('shows [C] Clear log hint', async () => {
      const { lastFrame, stdin, unmount } = renderApp();
      stdin.write('3'); // switch to log tab
      await tick();
      expect(lastFrame()).toContain('[C] Clear log');
      unmount();
    });
  });

  // -----------------------------------------------------------------------
  // Quit confirmation
  // -----------------------------------------------------------------------

  describe('quit confirmation (QQ)', () => {
    it('shows "Press Q again" hint after first Q', async () => {
      const { lastFrame, stdin, unmount } = renderApp();
      stdin.write('q');
      await tick();
      expect(lastFrame()).toContain('Press Q again to quit');
      unmount();
    });

    it('hint disappears after timeout (other key resets)', async () => {
      const { lastFrame, stdin, unmount } = renderApp();
      stdin.write('q');
      await tick();
      expect(lastFrame()).toContain('Press Q again');
      // Press another key — hint stays (timeout-based), but tabs still work
      stdin.write('2');
      await tick();
      expect(lastFrame()).toContain('[2] Editor');
      unmount();
    });

    it('first Q does not switch tabs', async () => {
      const { lastFrame, stdin, unmount } = renderApp();
      stdin.write('q');
      await tick();
      // Should still be on monitor
      expect(lastFrame()).toContain('[1] Monitor');
      expect(lastFrame()).toContain('Press Q again');
      unmount();
    });
  });

  // -----------------------------------------------------------------------
  // Monitor tab content
  // -----------------------------------------------------------------------

  describe('monitor tab', () => {
    it('shows rules from config', () => {
      const { lastFrame, unmount } = renderApp();
      expect(lastFrame()).toContain('Expression');
      expect(lastFrame()).toContain('Sustain');
      unmount();
    });

    it('shows updated activity when store changes', async () => {
      const { store, lastFrame, unmount } = renderApp();
      store.pushActivity({
        cc: 4,
        value: 80,
        mappedValue: 80,
        ruleLabel: 'Expression',
        timestamp: Date.now(),
      });
      await tick();
      const frame = lastFrame();
      expect(frame).toContain('80');
      unmount();
    });

    it('shows unmapped CCs', async () => {
      const { store, lastFrame, unmount } = renderApp();
      store.pushUnmapped(33, 100);
      await tick();
      expect(lastFrame()).toContain('33');
      unmount();
    });
  });

  // -----------------------------------------------------------------------
  // Editor tab: view vs edit mode
  // -----------------------------------------------------------------------

  describe('editor tab', () => {
    it('starts in VIEW mode', async () => {
      const { lastFrame, stdin, unmount } = renderApp();
      stdin.write('2');
      await tick();
      expect(lastFrame()).toContain('[VIEW]');
      unmount();
    });

    it('enters EDIT mode on Enter', async () => {
      const { lastFrame, stdin, unmount } = renderApp();
      stdin.write('2');
      await tick();
      stdin.write('\r'); // Enter
      await tick();
      expect(lastFrame()).toContain('[EDIT]');
      unmount();
    });

    it('returns to VIEW mode on Escape', async () => {
      const { lastFrame, stdin, unmount } = renderApp();
      stdin.write('2');
      await tick();
      stdin.write('\r'); // Enter → edit
      await tick();
      expect(lastFrame()).toContain('[EDIT]');
      stdin.write('\x1b'); // Escape
      await tick();
      expect(lastFrame()).toContain('[VIEW]');
      unmount();
    });
  });

  // -----------------------------------------------------------------------
  // Header
  // -----------------------------------------------------------------------

  describe('header', () => {
    it('shows MIDI Mapper title', () => {
      const { lastFrame, unmount } = renderApp();
      expect(lastFrame()).toContain('MIDI Mapper');
      unmount();
    });

    it('shows device name when connected', async () => {
      const { store, lastFrame, unmount } = renderApp();
      store.setDevice('My Controller');
      await tick();
      expect(lastFrame()).toContain('My Controller');
      unmount();
    });

    it('shows disconnected indicator initially', () => {
      const { lastFrame, unmount } = renderApp();
      expect(lastFrame()).toContain('○'); // disconnected
      unmount();
    });
  });

  // -----------------------------------------------------------------------
  // Shared mock editor helper
  // -----------------------------------------------------------------------

  function createMockEditor(store: TuiStore): ConfigEditorPort {
    return {
      getConfig: () => store.getState().config!,
      startMidiLearn: mock(() => new Promise<number>(() => {})),
      cancelMidiLearn: mock(() => {}),
      updateRule: mock(() => {}),
      addRule: mock((rule: any) => {
        const config = store.getState().config!;
        store.setConfig({ ...config, rules: [...config.rules, rule] });
      }),
      deleteRule: mock((index: number) => {
        const config = store.getState().config!;
        const rules = config.rules.filter((_: any, i: number) => i !== index);
        store.setConfig({ ...config, rules });
      }),
      updateMacro: mock(() => {}),
      addMacro: mock((macro: any) => {
        const config = store.getState().config!;
        store.setConfig({ ...config, macros: [...(config.macros ?? []), macro] });
      }),
      deleteMacro: mock((index: number) => {
        const config = store.getState().config!;
        const macros = (config.macros ?? []).filter((_: any, i: number) => i !== index);
        store.setConfig({ ...config, macros });
      }),
      updateDeviceName: mock(() => {}),
      saveConfig: mock(() => Promise.resolve()),
    };
  }

  // -----------------------------------------------------------------------
  // Editor tab: delete last rule
  // -----------------------------------------------------------------------

  describe('editor tab: delete last rule', () => {
    it('allows deleting a rule when only one remains', async () => {
      const SINGLE_RULE_CONFIG: AppConfig = {
        deviceName: 'Test Output',
        rules: [
          { cc: 4, label: 'Expression', inputMin: 0, inputMax: 127, outputMin: 0, outputMax: 127, curve: 'linear' },
        ],
      };

      const store = new TuiStore();
      store.setConfig(SINGLE_RULE_CONFIG);
      const editor = createMockEditor(store);

      const { lastFrame, stdin, unmount } = render(React.createElement(App, { store, configEditor: editor }));

      // Switch to editor tab
      stdin.write('2');
      await tick();
      expect(lastFrame()).toContain('[VIEW]');
      expect(lastFrame()).toContain('Expression');

      // Enter edit mode
      stdin.write('\r');
      await tick();
      expect(lastFrame()).toContain('[EDIT]');

      // Delete the last remaining rule
      stdin.write('d');
      await tick();

      // deleteRule should have been called
      expect(editor.deleteRule).toHaveBeenCalledWith(0);
      unmount();
    });
  });

  // -----------------------------------------------------------------------
  // Feature 1: Add rule from unmapped CC in Monitor tab
  // -----------------------------------------------------------------------

  describe('monitor tab: add rule from unmapped CC', () => {
    it('pressing A on unmapped CC creates rule and switches to editor', async () => {
      const store = new TuiStore();
      store.setConfig(TEST_CONFIG);
      const editor = createMockEditor(store);

      const { lastFrame, stdin, unmount } = render(React.createElement(App, { store, configEditor: editor }));

      // Start on monitor tab
      expect(lastFrame()).toContain('[1] Monitor');

      // Push an unmapped CC
      store.pushUnmapped(33, 100);
      await tick();
      expect(lastFrame()).toContain('33');
      expect(lastFrame()).toContain('[A] Add most recent as rule');

      // Press 'a' to add rule from the most recent unmapped CC
      stdin.write('a');
      await tick();

      // Should have called addRule with CC 33
      expect(editor.addRule).toHaveBeenCalledWith({
        cc: 33,
        label: 'CC 33',
        inputMin: 0,
        inputMax: 127,
        outputMin: 0,
        outputMax: 127,
        curve: 'linear',
      });

      // Should have switched to editor tab
      expect(lastFrame()).toContain('[2] Editor');

      // The new rule should be selected (index 2, since there were 2 existing rules)
      expect(store.getState().selectedRuleIndex).toBe(2);

      unmount();
    });

    it('pressing A with no unmapped CCs does nothing', async () => {
      const store = new TuiStore();
      store.setConfig(TEST_CONFIG);
      const editor = createMockEditor(store);

      const { lastFrame, stdin, unmount } = render(React.createElement(App, { store, configEditor: editor }));

      // No unmapped CCs — press 'a'
      stdin.write('a');
      await tick();

      // Should still be on monitor tab
      expect(lastFrame()).toContain('[1] Monitor');
      // addRule should NOT have been called
      expect(editor.addRule).not.toHaveBeenCalled();

      unmount();
    });

    it('selects the most recent unmapped CC when multiple exist', async () => {
      const store = new TuiStore();
      store.setConfig(TEST_CONFIG);
      const editor = createMockEditor(store);

      const { lastFrame, stdin, unmount } = render(React.createElement(App, { store, configEditor: editor }));

      // Push two unmapped CCs — CC 33 first, then CC 55
      store.pushUnmapped(33, 100);
      await tick();
      store.pushUnmapped(55, 80);
      await tick();

      // Press 'a' — should add the most recent (CC 55)
      stdin.write('a');
      await tick();

      expect(editor.addRule).toHaveBeenCalledWith(expect.objectContaining({ cc: 55, label: 'CC 55' }));

      unmount();
    });
  });

  // -----------------------------------------------------------------------
  // Feature 2: Macro CRUD in Editor tab
  // -----------------------------------------------------------------------

  describe('editor tab: macro CRUD', () => {
    it('shows macros section in editor', async () => {
      const configWithMacros: AppConfig = {
        ...TEST_CONFIG,
        macros: [
          {
            input: 10,
            label: 'My Macro',
            outputs: [{ cc: 20, label: 'Out1', outputMin: 0, outputMax: 127, curve: 'linear' as const }],
          },
        ],
      };

      const store = new TuiStore();
      store.setConfig(configWithMacros);
      const editor = createMockEditor(store);

      const { lastFrame, stdin, unmount } = render(React.createElement(App, { store, configEditor: editor }));

      // Switch to editor tab
      stdin.write('2');
      await tick();

      expect(lastFrame()).toContain('Macros');
      expect(lastFrame()).toContain('My Macro');
      expect(lastFrame()).toContain('CC20');

      unmount();
    });

    it('pressing N in view mode adds a new macro', async () => {
      const store = new TuiStore();
      store.setConfig(TEST_CONFIG);
      const editor = createMockEditor(store);

      const { lastFrame, stdin, unmount } = render(React.createElement(App, { store, configEditor: editor }));

      // Switch to editor tab
      stdin.write('2');
      await tick();

      // Press 'n' to add a macro
      stdin.write('n');
      await tick();

      expect(editor.addMacro).toHaveBeenCalledWith({
        input: 0,
        label: 'New Macro',
        outputs: [{ cc: 0, label: 'Output', outputMin: 0, outputMax: 127, curve: 'linear' }],
      });

      // The new macro should be visible
      expect(lastFrame()).toContain('New Macro');

      unmount();
    });

    it('pressing N in edit mode adds a new macro', async () => {
      const store = new TuiStore();
      store.setConfig(TEST_CONFIG);
      const editor = createMockEditor(store);

      const { lastFrame, stdin, unmount } = render(React.createElement(App, { store, configEditor: editor }));

      // Switch to editor tab and enter edit mode
      stdin.write('2');
      await tick();
      stdin.write('\r');
      await tick();
      expect(lastFrame()).toContain('[EDIT]');

      // Press 'n' to add a macro
      stdin.write('n');
      await tick();

      expect(editor.addMacro).toHaveBeenCalled();

      unmount();
    });

    it('pressing Shift+D in view mode deletes a macro', async () => {
      const configWithMacros: AppConfig = {
        ...TEST_CONFIG,
        macros: [
          {
            input: 10,
            label: 'Macro One',
            outputs: [{ cc: 20, label: 'Out1', outputMin: 0, outputMax: 127, curve: 'linear' as const }],
          },
          {
            input: 11,
            label: 'Macro Two',
            outputs: [{ cc: 21, label: 'Out2', outputMin: 0, outputMax: 127, curve: 'linear' as const }],
          },
        ],
      };

      const store = new TuiStore();
      store.setConfig(configWithMacros);
      const editor = createMockEditor(store);

      const { lastFrame, stdin, unmount } = render(React.createElement(App, { store, configEditor: editor }));

      // Switch to editor tab
      stdin.write('2');
      await tick();

      expect(lastFrame()).toContain('Macro One');
      expect(lastFrame()).toContain('Macro Two');

      // Press Shift+D to delete selected macro (index 0)
      stdin.write('D');
      await tick();

      expect(editor.deleteMacro).toHaveBeenCalledWith(0);

      // Macro One should be gone
      expect(lastFrame()).not.toContain('Macro One');
      expect(lastFrame()).toContain('Macro Two');

      unmount();
    });

    it('pressing Shift+D with no macros does nothing', async () => {
      const store = new TuiStore();
      store.setConfig(TEST_CONFIG);
      const editor = createMockEditor(store);

      const { lastFrame, stdin, unmount } = render(React.createElement(App, { store, configEditor: editor }));

      // Switch to editor tab
      stdin.write('2');
      await tick();

      // Press Shift+D — no macros to delete
      stdin.write('D');
      await tick();

      expect(editor.deleteMacro).not.toHaveBeenCalled();

      unmount();
    });

    it('shows [N] Add macro hint in editor tab', async () => {
      const store = new TuiStore();
      store.setConfig(TEST_CONFIG);

      const { lastFrame, stdin, unmount } = render(React.createElement(App, { store }));

      // Switch to editor tab
      stdin.write('2');
      await tick();

      expect(lastFrame()).toContain('[N] Add macro');

      unmount();
    });
  });

  // -----------------------------------------------------------------------
  // Editor tab: field navigation in EDIT mode
  // -----------------------------------------------------------------------

  describe('editor tab: field navigation', () => {
    const EDIT_CONFIG: AppConfig = {
      deviceName: 'Test',
      rules: [
        {
          cc: 4,
          label: 'Expression',
          inputMin: 10,
          inputMax: 120,
          outputMin: 0,
          outputMax: 127,
          curve: 'linear',
          smoothing: 3,
        },
        {
          cc: 64,
          label: 'Sustain',
          inputMin: 0,
          inputMax: 127,
          outputMin: 0,
          outputMax: 127,
          curve: 'linear',
          mode: 'toggle',
        },
      ],
    };

    async function enterEditMode(stdin: { write: (s: string) => void }) {
      stdin.write('2'); // switch to editor tab
      await tick();
      stdin.write('\r'); // enter edit mode
      await tick();
    }

    it('shows focused field indicator in edit mode', async () => {
      const store = new TuiStore();
      store.setConfig(EDIT_CONFIG);
      const editor = createMockEditor(store);
      const { lastFrame, stdin, unmount } = render(React.createElement(App, { store, configEditor: editor }));
      await enterEditMode(stdin);

      const frame = lastFrame();
      // Should show a focus indicator (▸ or >) on the first field
      expect(frame).toContain('[EDIT]');
      // First field (CC) should be visually highlighted
      expect(frame).toMatch(/▸.*CC/);
      unmount();
    });

    it('arrow down moves to next field, not next rule', async () => {
      const store = new TuiStore();
      store.setConfig(EDIT_CONFIG);
      const editor = createMockEditor(store);
      const { lastFrame, stdin, unmount } = render(React.createElement(App, { store, configEditor: editor }));
      await enterEditMode(stdin);

      // First field should be CC
      expect(lastFrame()).toMatch(/▸.*CC/);

      // Arrow down → should move to Label field, NOT to next rule
      stdin.write('\x1b[B'); // down arrow
      await tick();

      const frame = lastFrame();
      expect(frame).toMatch(/▸.*Label/);
      // Should still be editing Rule 1, not Rule 2
      expect(frame).toContain('Rule 1');
      unmount();
    });

    it('arrow up moves to previous field', async () => {
      const store = new TuiStore();
      store.setConfig(EDIT_CONFIG);
      const editor = createMockEditor(store);
      const { lastFrame, stdin, unmount } = render(React.createElement(App, { store, configEditor: editor }));
      await enterEditMode(stdin);

      // Move down to Label
      stdin.write('\x1b[B');
      await tick();
      expect(lastFrame()).toMatch(/▸.*Label/);

      // Move back up to CC
      stdin.write('\x1b[A');
      await tick();
      expect(lastFrame()).toMatch(/▸.*CC/);
      unmount();
    });

    it('arrow up on first field does not wrap', async () => {
      const store = new TuiStore();
      store.setConfig(EDIT_CONFIG);
      const editor = createMockEditor(store);
      const { lastFrame, stdin, unmount } = render(React.createElement(App, { store, configEditor: editor }));
      await enterEditMode(stdin);

      // Already on first field (CC), press up
      stdin.write('\x1b[A');
      await tick();

      // Should still be on CC
      expect(lastFrame()).toMatch(/▸.*CC/);
      unmount();
    });

    it('arrow down on last field does not wrap', async () => {
      const store = new TuiStore();
      store.setConfig(EDIT_CONFIG);
      const editor = createMockEditor(store);
      const { lastFrame, stdin, unmount } = render(React.createElement(App, { store, configEditor: editor }));
      await enterEditMode(stdin);

      // Navigate to the last field by pressing down many times
      for (let i = 0; i < 20; i++) {
        stdin.write('\x1b[B');
        await tick();
      }

      const frame = lastFrame();
      // Should be on Mode (last field) — still Rule 1
      expect(frame).toContain('Rule 1');
      expect(frame).toMatch(/▸.*Mode/);
      unmount();
    });

    it('Enter on a text field opens inline editor', async () => {
      const store = new TuiStore();
      store.setConfig(EDIT_CONFIG);
      const editor = createMockEditor(store);
      const { lastFrame, stdin, unmount } = render(React.createElement(App, { store, configEditor: editor }));
      await enterEditMode(stdin);

      // Move to Label field
      stdin.write('\x1b[B');
      await tick();

      // Press Enter to edit
      stdin.write('\r');
      await tick();

      // Should be in edit-field mode — TextInput should be visible
      const frame = lastFrame();
      expect(frame).toContain('Expression'); // current value shown in input
      unmount();
    });

    it('left/right on Curve field cycles curve type', async () => {
      const store = new TuiStore();
      store.setConfig(EDIT_CONFIG);
      const editor = createMockEditor(store);
      const { lastFrame, stdin, unmount } = render(React.createElement(App, { store, configEditor: editor }));
      await enterEditMode(stdin);

      // Navigate to Curve field (CC=0, Label=1, InputMin=2, InputMax=3, OutputMin=4, OutputMax=5, Curve=6)
      for (let i = 0; i < 6; i++) {
        stdin.write('\x1b[B');
        await tick();
      }
      expect(lastFrame()).toMatch(/▸.*Curve/);
      expect(lastFrame()).toContain('[EDIT]');

      // Press right → should cycle to next curve
      stdin.write('\x1b[C'); // right arrow
      await tick();

      expect(editor.updateRule).toHaveBeenCalled();
      unmount();
    });

    it('Escape returns to view mode from any field', async () => {
      const store = new TuiStore();
      store.setConfig(EDIT_CONFIG);
      const editor = createMockEditor(store);
      const { lastFrame, stdin, unmount } = render(React.createElement(App, { store, configEditor: editor }));
      await enterEditMode(stdin);

      // Navigate down a few fields
      stdin.write('\x1b[B');
      stdin.write('\x1b[B');
      await tick();

      // Escape → back to view
      stdin.write('\x1b');
      await tick();
      expect(lastFrame()).toContain('[VIEW]');
      unmount();
    });
  });
});
