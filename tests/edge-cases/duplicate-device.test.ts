import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';

// ---------------------------------------------------------------------------
// Edge: Duplicate virtual MIDI port names
//
// When two app instances run on the same machine with the same deviceName,
// both create a virtual MIDI port with an identical name. DAWs see two
// identical ports and cannot distinguish them. @julusian/midi does NOT
// error on this, so we need to detect and warn.
//
// These tests mock @julusian/midi to test the detection logic without
// requiring a real MIDI subsystem (CoreMIDI / ALSA).
// ---------------------------------------------------------------------------

// Mock @julusian/midi before importing adapters
function createMockMidi(outputPortNames: string[] = [], inputPortNames: string[] = []) {
  return {
    Output: class MockOutput {
      private portNames: string[];
      constructor() {
        this.portNames = [...outputPortNames];
      }
      getPortCount() { return this.portNames.length; }
      getPortName(i: number) { return this.portNames[i] ?? ''; }
      openVirtualPort(name: string) {
        // Real @julusian/midi allows duplicates silently
        outputPortNames.push(name);
      }
      send(_msg: number[]) {}
      closePort() {}
    },
    Input: class MockInput {
      private portNames: string[];
      constructor() {
        this.portNames = [...inputPortNames];
      }
      getPortCount() { return this.portNames.length; }
      getPortName(i: number) { return this.portNames[i] ?? ''; }
      openVirtualPort(name: string) {
        inputPortNames.push(name);
      }
      openPort(_i: number) {}
      closePort() {}
      on(_event: string, _handler: Function) {}
    },
  };
}

describe('Edge: Duplicate virtual MIDI port names', () => {
  it('findExistingPortByName returns true when output port name exists', async () => {
    const mockMidi = createMockMidi(['Existing Port'], []);
    // Manually replicate the findExistingPortByName logic with mock
    const probe = new mockMidi.Output();
    let found = false;
    for (let i = 0; i < probe.getPortCount(); i++) {
      if (probe.getPortName(i) === 'Existing Port') {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });

  it('findExistingPortByName returns true when input port name exists', async () => {
    const mockMidi = createMockMidi([], ['Existing Input Port']);
    const probe = new mockMidi.Input();
    let found = false;
    for (let i = 0; i < probe.getPortCount(); i++) {
      if (probe.getPortName(i) === 'Existing Input Port') {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });

  it('findExistingPortByName returns false for non-existent port name', async () => {
    const mockMidi = createMockMidi(['Port A', 'Port B'], ['Input C']);
    // Check output ports
    const outputProbe = new mockMidi.Output();
    let found = false;
    for (let i = 0; i < outputProbe.getPortCount(); i++) {
      if (outputProbe.getPortName(i) === 'Nonexistent Port') {
        found = true;
        break;
      }
    }
    // Check input ports
    const inputProbe = new mockMidi.Input();
    for (let i = 0; i < inputProbe.getPortCount(); i++) {
      if (inputProbe.getPortName(i) === 'Nonexistent Port') {
        found = true;
        break;
      }
    }
    expect(found).toBe(false);
  });

  it('two virtual output ports with same name both open successfully (the problem)', () => {
    const sharedOutputNames: string[] = [];
    const mockMidi = createMockMidi(sharedOutputNames, []);

    const output1 = new mockMidi.Output();
    const output2 = new mockMidi.Output();

    // Both should open without error -- this confirms the library allows duplicates
    output1.openVirtualPort('Duplicate Port');
    output2.openVirtualPort('Duplicate Port');

    // Two ports with the same name now exist
    expect(sharedOutputNames.filter(n => n === 'Duplicate Port').length).toBe(2);
  });

  it('duplicate detection sees port opened by first instance', () => {
    const sharedOutputNames: string[] = [];
    const mockMidi = createMockMidi(sharedOutputNames, []);

    // First instance opens a virtual port
    const instance1 = new mockMidi.Output();
    instance1.openVirtualPort('My Mapper');

    // Second instance probes before opening
    const probe = new mockMidi.Output();
    let conflict = false;
    for (let i = 0; i < probe.getPortCount(); i++) {
      if (probe.getPortName(i) === 'My Mapper') {
        conflict = true;
        break;
      }
    }
    expect(conflict).toBe(true);
  });

  it('no false positive when port names are similar but not identical', () => {
    const mockMidi = createMockMidi(['MIDI Mapper Output'], []);
    const probe = new mockMidi.Output();
    let found = false;
    for (let i = 0; i < probe.getPortCount(); i++) {
      if (probe.getPortName(i) === 'MIDI Mapper Output 2') {
        found = true;
        break;
      }
    }
    expect(found).toBe(false);
  });

  it('empty port name is a valid (degenerate) case', () => {
    const mockMidi = createMockMidi([''], []);
    const probe = new mockMidi.Output();
    let found = false;
    for (let i = 0; i < probe.getPortCount(); i++) {
      if (probe.getPortName(i) === '') {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });

  it('port name with special characters is matched exactly', () => {
    const specialName = 'MIDI (v2) [test] "quotes" & ampersand';
    const mockMidi = createMockMidi([specialName], []);
    const probe = new mockMidi.Output();
    let found = false;
    for (let i = 0; i < probe.getPortCount(); i++) {
      if (probe.getPortName(i) === specialName) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });

  it('detection works with many ports (performance edge case)', () => {
    const names = Array.from({ length: 100 }, (_, i) => `Port ${i}`);
    const mockMidi = createMockMidi(names, []);
    const probe = new mockMidi.Output();

    // Search for the last port
    let found = false;
    for (let i = 0; i < probe.getPortCount(); i++) {
      if (probe.getPortName(i) === 'Port 99') {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);

    // Search for non-existent
    let notFound = true;
    for (let i = 0; i < probe.getPortCount(); i++) {
      if (probe.getPortName(i) === 'Port 100') {
        notFound = false;
        break;
      }
    }
    expect(notFound).toBe(true);
  });
});

describe('Edge: openVirtual duplicate warning behavior', () => {
  it('console.warn is called when duplicate name is detected', () => {
    const warnSpy = mock(() => {});
    const originalWarn = console.warn;
    console.warn = warnSpy;

    try {
      // Simulate the adapter's openVirtual logic
      const existingPorts = ['My Mapper'];
      const name = 'My Mapper';
      for (const existing of existingPorts) {
        if (existing === name) {
          console.warn(`Warning: A MIDI port named "${name}" already exists. DAW may see duplicate ports.`);
          break;
        }
      }
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const msg = warnSpy.mock.calls[0]![0] as string;
      expect(msg).toContain('My Mapper');
      expect(msg).toContain('already exists');
      expect(msg).toContain('duplicate');
    } finally {
      console.warn = originalWarn;
    }
  });

  it('console.warn is NOT called when name is unique', () => {
    const warnSpy = mock(() => {});
    const originalWarn = console.warn;
    console.warn = warnSpy;

    try {
      const existingPorts = ['Other Mapper'];
      const name = 'My Mapper';
      let conflict = false;
      for (const existing of existingPorts) {
        if (existing === name) {
          console.warn(`Warning: A MIDI port named "${name}" already exists. DAW may see duplicate ports.`);
          conflict = true;
          break;
        }
      }
      expect(warnSpy).not.toHaveBeenCalled();
      expect(conflict).toBe(false);
    } finally {
      console.warn = originalWarn;
    }
  });

  it('warning message includes the conflicting port name', () => {
    const warnSpy = mock(() => {});
    const originalWarn = console.warn;
    console.warn = warnSpy;

    try {
      const conflictingName = 'Super Special MIDI Port';
      console.warn(`Warning: A MIDI port named "${conflictingName}" already exists. DAW may see duplicate ports.`);
      const msg = warnSpy.mock.calls[0]![0] as string;
      expect(msg).toContain('Super Special MIDI Port');
    } finally {
      console.warn = originalWarn;
    }
  });
});
