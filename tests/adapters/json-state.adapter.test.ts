import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { join } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { JsonStateAdapter } from '@adapters/json-state.adapter';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'midi-mapper-state-'));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('JsonStateAdapter', () => {
  describe('constructor', () => {
    it('uses default path when none provided', () => {
      const adapter = new JsonStateAdapter();
      // We can't directly access the private path, but we can verify the adapter was created
      expect(adapter).toBeInstanceOf(JsonStateAdapter);
    });

    it('accepts a custom path', () => {
      const adapter = new JsonStateAdapter(join(tmpDir, 'custom.json'));
      expect(adapter).toBeInstanceOf(JsonStateAdapter);
    });
  });

  describe('load', () => {
    it('returns default state when file does not exist', async () => {
      const adapter = new JsonStateAdapter(join(tmpDir, 'state.json'));
      const state = await adapter.load();
      expect(state).toEqual({});
    });

    it('reads saved lastDevice', async () => {
      const filePath = join(tmpDir, 'state.json');
      await Bun.write(filePath, JSON.stringify({ lastDevice: 'My Controller' }));
      const adapter = new JsonStateAdapter(filePath);
      const state = await adapter.load();
      expect(state.lastDevice).toBe('My Controller');
    });

    it('returns default state on invalid JSON', async () => {
      const filePath = join(tmpDir, 'state.json');
      await Bun.write(filePath, '{{not json}}');
      const adapter = new JsonStateAdapter(filePath);
      const state = await adapter.load();
      expect(state).toEqual({});
    });

    it('returns default state when file contains non-object JSON', async () => {
      const filePath = join(tmpDir, 'state.json');
      await Bun.write(filePath, '"just a string"');
      const adapter = new JsonStateAdapter(filePath);
      const state = await adapter.load();
      expect(state).toEqual({});
    });

    it('returns default state when file contains null', async () => {
      const filePath = join(tmpDir, 'state.json');
      await Bun.write(filePath, 'null');
      const adapter = new JsonStateAdapter(filePath);
      const state = await adapter.load();
      expect(state).toEqual({});
    });

    it('strips unknown fields and keeps lastDevice', async () => {
      const filePath = join(tmpDir, 'state.json');
      await Bun.write(filePath, JSON.stringify({ lastDevice: 'X', foo: 'bar' }));
      const adapter = new JsonStateAdapter(filePath);
      const state = await adapter.load();
      expect(state.lastDevice).toBe('X');
      expect((state as any).foo).toBeUndefined();
    });

    it('returns default state when lastDevice is not a string', async () => {
      const filePath = join(tmpDir, 'state.json');
      await Bun.write(filePath, JSON.stringify({ lastDevice: 123 }));
      const adapter = new JsonStateAdapter(filePath);
      const state = await adapter.load();
      expect(state).toEqual({});
    });

    it('reads saved lastMode', async () => {
      const filePath = join(tmpDir, 'state.json');
      await Bun.write(filePath, JSON.stringify({ lastMode: 'host' }));
      const adapter = new JsonStateAdapter(filePath);
      const state = await adapter.load();
      expect(state.lastMode).toBe('host');
    });

    it('reads saved lastMode "join"', async () => {
      const filePath = join(tmpDir, 'state.json');
      await Bun.write(filePath, JSON.stringify({ lastMode: 'join' }));
      const adapter = new JsonStateAdapter(filePath);
      const state = await adapter.load();
      expect(state.lastMode).toBe('join');
    });

    it('reads saved lastMode "local"', async () => {
      const filePath = join(tmpDir, 'state.json');
      await Bun.write(filePath, JSON.stringify({ lastMode: 'local' }));
      const adapter = new JsonStateAdapter(filePath);
      const state = await adapter.load();
      expect(state.lastMode).toBe('local');
    });

    it('ignores invalid lastMode values', async () => {
      const filePath = join(tmpDir, 'state.json');
      await Bun.write(filePath, JSON.stringify({ lastMode: 'invalid' }));
      const adapter = new JsonStateAdapter(filePath);
      const state = await adapter.load();
      expect(state.lastMode).toBeUndefined();
    });

    it('ignores lastMode when it is not a string', async () => {
      const filePath = join(tmpDir, 'state.json');
      await Bun.write(filePath, JSON.stringify({ lastMode: 42 }));
      const adapter = new JsonStateAdapter(filePath);
      const state = await adapter.load();
      expect(state.lastMode).toBeUndefined();
    });

    it('lastMode is optional (backward compat with existing state files)', async () => {
      const filePath = join(tmpDir, 'state.json');
      await Bun.write(filePath, JSON.stringify({ lastDevice: 'MyDevice' }));
      const adapter = new JsonStateAdapter(filePath);
      const state = await adapter.load();
      expect(state.lastDevice).toBe('MyDevice');
      expect(state.lastMode).toBeUndefined();
    });

    it('reads both lastDevice and lastMode', async () => {
      const filePath = join(tmpDir, 'state.json');
      await Bun.write(filePath, JSON.stringify({ lastDevice: 'MyDevice', lastMode: 'host' }));
      const adapter = new JsonStateAdapter(filePath);
      const state = await adapter.load();
      expect(state.lastDevice).toBe('MyDevice');
      expect(state.lastMode).toBe('host');
    });

    it('returns default state when file contains an array', async () => {
      const filePath = join(tmpDir, 'state.json');
      await Bun.write(filePath, '[1, 2, 3]');
      const adapter = new JsonStateAdapter(filePath);
      const state = await adapter.load();
      expect(state).toEqual({});
    });
  });

  describe('save', () => {
    it('writes lastDevice to file', async () => {
      const filePath = join(tmpDir, 'state.json');
      const adapter = new JsonStateAdapter(filePath);
      await adapter.save({ lastDevice: 'Saved Controller' });
      const raw = await Bun.file(filePath).text();
      expect(JSON.parse(raw)).toEqual({ lastDevice: 'Saved Controller' });
    });

    it('creates parent directories if they do not exist', async () => {
      const filePath = join(tmpDir, 'nested', 'deep', 'state.json');
      const adapter = new JsonStateAdapter(filePath);
      await adapter.save({ lastDevice: 'Deep' });
      const raw = await Bun.file(filePath).text();
      expect(JSON.parse(raw)).toEqual({ lastDevice: 'Deep' });
    });

    it('overwrites existing state', async () => {
      const filePath = join(tmpDir, 'state.json');
      const adapter = new JsonStateAdapter(filePath);
      await adapter.save({ lastDevice: 'First' });
      await adapter.save({ lastDevice: 'Second' });
      const raw = await Bun.file(filePath).text();
      expect(JSON.parse(raw)).toEqual({ lastDevice: 'Second' });
    });

    it('writes empty object when no lastDevice', async () => {
      const filePath = join(tmpDir, 'state.json');
      const adapter = new JsonStateAdapter(filePath);
      await adapter.save({});
      const raw = await Bun.file(filePath).text();
      expect(JSON.parse(raw)).toEqual({});
    });

    it('saves lastMode to file', async () => {
      const filePath = join(tmpDir, 'state.json');
      const adapter = new JsonStateAdapter(filePath);
      await adapter.save({ lastMode: 'host' });
      const raw = await Bun.file(filePath).text();
      expect(JSON.parse(raw)).toEqual({ lastMode: 'host' });
    });

    it('saves both lastDevice and lastMode', async () => {
      const filePath = join(tmpDir, 'state.json');
      const adapter = new JsonStateAdapter(filePath);
      await adapter.save({ lastDevice: 'Controller', lastMode: 'join' });
      const raw = await Bun.file(filePath).text();
      expect(JSON.parse(raw)).toEqual({ lastDevice: 'Controller', lastMode: 'join' });
    });

    it('saves and loads lastMode round-trip', async () => {
      const filePath = join(tmpDir, 'state.json');
      const adapter = new JsonStateAdapter(filePath);
      await adapter.save({ lastMode: 'local' });
      const state = await adapter.load();
      expect(state.lastMode).toBe('local');
    });
  });
});
