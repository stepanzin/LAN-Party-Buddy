import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { JsonStateAdapter } from '@adapters/json-state.adapter';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'midi-mapper-integration-'));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('Integration: State Persistence', () => {
  it('saves and loads device name through full adapter cycle', async () => {
    const filePath = join(tmpDir, 'state.json');
    const adapter = new JsonStateAdapter(filePath);

    await adapter.save({ lastDevice: 'Arturia KeyStep' });
    const loaded = await adapter.load();

    expect(loaded.lastDevice).toBe('Arturia KeyStep');
  });

  it('persists across multiple save/load cycles', async () => {
    const filePath = join(tmpDir, 'state.json');
    const adapter = new JsonStateAdapter(filePath);

    // Save A, verify A
    await adapter.save({ lastDevice: 'Device A' });
    const loadedA = await adapter.load();
    expect(loadedA.lastDevice).toBe('Device A');

    // Save B, verify B (overwritten)
    await adapter.save({ lastDevice: 'Device B' });
    const loadedB = await adapter.load();
    expect(loadedB.lastDevice).toBe('Device B');
  });

  it('handles corrupt state file gracefully', async () => {
    const filePath = join(tmpDir, 'state.json');

    // Write garbage to state file
    await Bun.write(filePath, '!!!not-json{{{garbage%%%');

    const adapter = new JsonStateAdapter(filePath);
    const loaded = await adapter.load();

    // Should return default empty state instead of crashing
    expect(loaded).toEqual({});
  });

  it('handles empty file gracefully', async () => {
    const filePath = join(tmpDir, 'state.json');
    await Bun.write(filePath, '');

    const adapter = new JsonStateAdapter(filePath);
    const loaded = await adapter.load();

    expect(loaded).toEqual({});
  });

  it('survives save after loading corrupt state', async () => {
    const filePath = join(tmpDir, 'state.json');

    // Start with corrupt file
    await Bun.write(filePath, 'CORRUPT_DATA');
    const adapter = new JsonStateAdapter(filePath);

    // Load returns default
    const loaded = await adapter.load();
    expect(loaded).toEqual({});

    // Save new valid state
    await adapter.save({ lastDevice: 'Recovered Device' });

    // Load it back
    const recovered = await adapter.load();
    expect(recovered.lastDevice).toBe('Recovered Device');
  });

  it('uses separate files for separate adapter instances', async () => {
    const pathA = join(tmpDir, 'a.json');
    const pathB = join(tmpDir, 'b.json');

    const adapterA = new JsonStateAdapter(pathA);
    const adapterB = new JsonStateAdapter(pathB);

    await adapterA.save({ lastDevice: 'Device A' });
    await adapterB.save({ lastDevice: 'Device B' });

    const loadedA = await adapterA.load();
    const loadedB = await adapterB.load();

    expect(loadedA.lastDevice).toBe('Device A');
    expect(loadedB.lastDevice).toBe('Device B');
  });

  it('creates nested directories on save', async () => {
    const filePath = join(tmpDir, 'deep', 'nested', 'dir', 'state.json');
    const adapter = new JsonStateAdapter(filePath);

    await adapter.save({ lastDevice: 'Nested Device' });
    const loaded = await adapter.load();

    expect(loaded.lastDevice).toBe('Nested Device');
  });

  it('round-trips state without lastDevice as empty object', async () => {
    const filePath = join(tmpDir, 'state.json');
    const adapter = new JsonStateAdapter(filePath);

    await adapter.save({});
    const loaded = await adapter.load();

    expect(loaded).toEqual({});
    expect(loaded.lastDevice).toBeUndefined();
  });
});
