import { describe, it, expect, vi } from 'vitest';
import { TuiStore } from '../../../src/adapters/ink-tui/tui-store';
import type {
  ActivityEntry,
  MacroActivityEntry,
  LogEntry,
} from '../../../src/adapters/ink-tui/tui-store';
import type { AppConfig } from '../../../src/domain/config';
import type { MidiDevice } from '../../../src/ports/device-discovery.port';

function makeActivity(cc: number, value = 64, mappedValue = 64): ActivityEntry {
  return { cc, value, mappedValue, timestamp: Date.now() };
}

function makeMacroActivity(inputCc: number): MacroActivityEntry {
  return { inputCc, outputs: [{ cc: 20, value: 100 }], timestamp: Date.now() };
}

function makeLogEntry(cc: number, matched = true): LogEntry {
  return {
    timestamp: Date.now(),
    cc,
    originalValue: 64,
    mappedValue: 100,
    matched,
  };
}

function makeConfig(deviceName = 'TestDevice'): AppConfig {
  return {
    deviceName,
    rules: [
      {
        cc: 1,
        label: 'Modulation',
        inputMin: 0,
        inputMax: 127,
        outputMin: 0,
        outputMax: 127,
        curve: 'linear',
      },
    ],
  };
}

describe('TuiStore', () => {
  describe('initial state', () => {
    it('has correct defaults', () => {
      const store = new TuiStore();
      const state = store.getState();

      expect(state.tab).toBe('monitor');
      expect(state.device).toBeNull();
      expect(state.connected).toBe(false);
      expect(state.messageCount).toBe(0);
      expect(state.startTime).toBeGreaterThan(0);
      expect(state.activities).toEqual([]);
      expect(state.macroActivities).toEqual([]);
      expect(state.unmapped).toBeInstanceOf(Map);
      expect(state.unmapped.size).toBe(0);
      expect(state.config).toBeNull();
      expect(state.selectedRuleIndex).toBe(0);
      expect(state.midiLearnActive).toBe(false);
      expect(state.midiLearnCaptured).toBeNull();
      expect(state.logEntries).toEqual([]);
      expect(state.saveStatus).toBeNull();
      expect(state.deviceSelectionDevices).toBeNull();
      expect(state.deviceSelectionResolver).toBeNull();
    });
  });

  describe('setTab', () => {
    it('changes tab', () => {
      const store = new TuiStore();
      store.setTab('editor');
      expect(store.getState().tab).toBe('editor');

      store.setTab('log');
      expect(store.getState().tab).toBe('log');

      store.setTab('monitor');
      expect(store.getState().tab).toBe('monitor');
    });
  });

  describe('pushActivity', () => {
    it('adds an activity entry', () => {
      const store = new TuiStore();
      const entry = makeActivity(1);
      store.pushActivity(entry);
      expect(store.getState().activities).toHaveLength(1);
      expect(store.getState().activities[0]).toEqual(entry);
    });

    it('caps at 20 entries', () => {
      const store = new TuiStore();
      for (let i = 0; i < 25; i++) {
        store.pushActivity(makeActivity(i));
      }
      const activities = store.getState().activities;
      expect(activities).toHaveLength(20);
      // The first 5 should have been evicted; first remaining should be cc=5
      expect(activities[0].cc).toBe(5);
      expect(activities[19].cc).toBe(24);
    });

    it('increments messageCount', () => {
      const store = new TuiStore();
      store.pushActivity(makeActivity(1));
      expect(store.getState().messageCount).toBe(1);
      store.pushActivity(makeActivity(2));
      expect(store.getState().messageCount).toBe(2);
    });
  });

  describe('pushMacroActivity', () => {
    it('adds a macro activity entry', () => {
      const store = new TuiStore();
      const entry = makeMacroActivity(10);
      store.pushMacroActivity(entry);
      expect(store.getState().macroActivities).toHaveLength(1);
      expect(store.getState().macroActivities[0]).toEqual(entry);
    });

    it('caps at 10 entries', () => {
      const store = new TuiStore();
      for (let i = 0; i < 15; i++) {
        store.pushMacroActivity(makeMacroActivity(i));
      }
      const macros = store.getState().macroActivities;
      expect(macros).toHaveLength(10);
      expect(macros[0].inputCc).toBe(5);
      expect(macros[9].inputCc).toBe(14);
    });
  });

  describe('pushUnmapped', () => {
    it('adds an unmapped entry', () => {
      const store = new TuiStore();
      store.pushUnmapped(42, 100);
      const unmapped = store.getState().unmapped;
      expect(unmapped.size).toBe(1);
      expect(unmapped.get(42)).toMatchObject({ cc: 42, value: 100 });
    });

    it('updates existing unmapped entry for same CC', () => {
      const store = new TuiStore();
      store.pushUnmapped(42, 50);
      store.pushUnmapped(42, 100);
      const unmapped = store.getState().unmapped;
      expect(unmapped.size).toBe(1);
      expect(unmapped.get(42)!.value).toBe(100);
    });

    it('tracks multiple CCs', () => {
      const store = new TuiStore();
      store.pushUnmapped(1, 10);
      store.pushUnmapped(2, 20);
      store.pushUnmapped(3, 30);
      expect(store.getState().unmapped.size).toBe(3);
    });

    it('caps unmapped entries at 20, removing oldest', () => {
      const store = new TuiStore();
      // Push 25 unique CCs with increasing timestamps
      for (let i = 0; i < 25; i++) {
        store.pushUnmapped(i, i * 10);
      }
      const unmapped = store.getState().unmapped;
      expect(unmapped.size).toBe(20);
      // The first 5 (CCs 0-4) should have been evicted as oldest
      for (let i = 0; i < 5; i++) {
        expect(unmapped.has(i)).toBe(false);
      }
      // CCs 5-24 should remain
      for (let i = 5; i < 25; i++) {
        expect(unmapped.has(i)).toBe(true);
      }
    });

    it('does not evict when updating existing CC within cap', () => {
      const store = new TuiStore();
      // Push exactly 20 unique CCs
      for (let i = 0; i < 20; i++) {
        store.pushUnmapped(i, i * 10);
      }
      expect(store.getState().unmapped.size).toBe(20);
      // Update an existing CC -- should not shrink
      store.pushUnmapped(0, 999);
      expect(store.getState().unmapped.size).toBe(20);
      expect(store.getState().unmapped.get(0)!.value).toBe(999);
    });
  });

  describe('setDevice', () => {
    it('sets device name and connected to true', () => {
      const store = new TuiStore();
      store.setDevice('My MIDI Controller');
      expect(store.getState().device).toBe('My MIDI Controller');
      expect(store.getState().connected).toBe(true);
    });
  });

  describe('setConnectionStatus', () => {
    it('updates connected status', () => {
      const store = new TuiStore();
      store.setConnectionStatus(true);
      expect(store.getState().connected).toBe(true);

      store.setConnectionStatus(false);
      expect(store.getState().connected).toBe(false);
    });
  });

  describe('setConfig', () => {
    it('updates config', () => {
      const store = new TuiStore();
      const config = makeConfig();
      store.setConfig(config);
      expect(store.getState().config).toEqual(config);
    });
  });

  describe('setSelectedRuleIndex', () => {
    it('updates selectedRuleIndex', () => {
      const store = new TuiStore();
      store.setSelectedRuleIndex(3);
      expect(store.getState().selectedRuleIndex).toBe(3);
    });
  });

  describe('setMidiLearnActive', () => {
    it('activates midi learn and clears captured', () => {
      const store = new TuiStore();
      // First set a captured value
      store.setMidiLearnCaptured(42);
      expect(store.getState().midiLearnCaptured).toBe(42);

      // Activating should clear captured
      store.setMidiLearnActive(true);
      expect(store.getState().midiLearnActive).toBe(true);
      expect(store.getState().midiLearnCaptured).toBeNull();
    });

    it('deactivates midi learn and preserves captured', () => {
      const store = new TuiStore();
      store.setMidiLearnCaptured(42);
      store.setMidiLearnActive(false);
      expect(store.getState().midiLearnActive).toBe(false);
      expect(store.getState().midiLearnCaptured).toBe(42);
    });
  });

  describe('setMidiLearnCaptured', () => {
    it('sets captured CC and deactivates learn mode', () => {
      const store = new TuiStore();
      store.setMidiLearnActive(true);
      store.setMidiLearnCaptured(99);
      expect(store.getState().midiLearnActive).toBe(false);
      expect(store.getState().midiLearnCaptured).toBe(99);
    });
  });

  describe('pushLog', () => {
    it('adds a log entry', () => {
      const store = new TuiStore();
      const entry = makeLogEntry(1);
      store.pushLog(entry);
      expect(store.getState().logEntries).toHaveLength(1);
      expect(store.getState().logEntries[0]).toEqual(entry);
    });

    it('caps at 200 entries', () => {
      const store = new TuiStore();
      for (let i = 0; i < 210; i++) {
        store.pushLog(makeLogEntry(i));
      }
      const logs = store.getState().logEntries;
      expect(logs).toHaveLength(200);
      expect(logs[0].cc).toBe(10);
      expect(logs[199].cc).toBe(209);
    });
  });

  describe('clearLog', () => {
    it('empties log entries', () => {
      const store = new TuiStore();
      store.pushLog(makeLogEntry(1));
      store.pushLog(makeLogEntry(2));
      expect(store.getState().logEntries).toHaveLength(2);

      store.clearLog();
      expect(store.getState().logEntries).toEqual([]);
    });
  });

  describe('setSaveStatus', () => {
    it('sets the save status', () => {
      const store = new TuiStore();
      store.setSaveStatus('Saved!');
      expect(store.getState().saveStatus).toBe('Saved!');
    });

    it('clears save status when set to null', () => {
      const store = new TuiStore();
      store.setSaveStatus('Saved!');
      store.setSaveStatus(null);
      expect(store.getState().saveStatus).toBeNull();
    });

    it('auto-clears after timeout', async () => {
      const store = new TuiStore();
      store.setSaveStatus('Saved!');
      expect(store.getState().saveStatus).toBe('Saved!');
      // After 2.5 seconds it should clear
      await new Promise(r => setTimeout(r, 2500));
      expect(store.getState().saveStatus).toBeNull();
    });
  });

  describe('subscribe', () => {
    it('is called on changes', () => {
      const store = new TuiStore();
      const listener = vi.fn();
      store.subscribe(listener);

      store.setTab('editor');
      expect(listener).toHaveBeenCalledTimes(1);

      store.setConnectionStatus(true);
      expect(listener).toHaveBeenCalledTimes(2);
    });

    it('returns an unsubscribe function', () => {
      const store = new TuiStore();
      const listener = vi.fn();
      const unsubscribe = store.subscribe(listener);

      store.setTab('editor');
      expect(listener).toHaveBeenCalledTimes(1);

      unsubscribe();

      store.setTab('log');
      // Should not have been called again after unsubscribe
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe('setDeviceSelection', () => {
    it('sets devices and resolver', () => {
      const store = new TuiStore();
      const devices: MidiDevice[] = [
        { index: 0, name: 'Device A' },
        { index: 1, name: 'Device B' },
      ];
      const resolver = vi.fn();

      store.setDeviceSelection(devices, resolver);
      expect(store.getState().deviceSelectionDevices).toEqual(devices);
      expect(store.getState().deviceSelectionResolver).toBe(resolver);
    });
  });

  describe('resolveDeviceSelection', () => {
    it('calls resolver with index and clears selection state', () => {
      const store = new TuiStore();
      const devices: MidiDevice[] = [
        { index: 0, name: 'Device A' },
        { index: 1, name: 'Device B' },
      ];
      const resolver = vi.fn();
      store.setDeviceSelection(devices, resolver);

      store.resolveDeviceSelection(1);
      expect(resolver).toHaveBeenCalledWith(1);
      expect(store.getState().deviceSelectionDevices).toBeNull();
      expect(store.getState().deviceSelectionResolver).toBeNull();
    });

    it('handles resolveDeviceSelection when no resolver is set', () => {
      const store = new TuiStore();
      // Should not throw
      expect(() => store.resolveDeviceSelection(0)).not.toThrow();
      expect(store.getState().deviceSelectionDevices).toBeNull();
      expect(store.getState().deviceSelectionResolver).toBeNull();
    });
  });

  describe('messageCount', () => {
    it('increments on each pushActivity call', () => {
      const store = new TuiStore();
      expect(store.getState().messageCount).toBe(0);

      store.pushActivity(makeActivity(1));
      expect(store.getState().messageCount).toBe(1);

      store.pushActivity(makeActivity(2));
      expect(store.getState().messageCount).toBe(2);

      store.pushActivity(makeActivity(3));
      expect(store.getState().messageCount).toBe(3);
    });
  });
});
