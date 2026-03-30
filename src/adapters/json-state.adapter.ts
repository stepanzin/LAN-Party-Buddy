import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { AppState, StateStorePort } from '@ports/state-store.port';

export class JsonStateAdapter implements StateStorePort {
  private path: string;

  constructor(path?: string) {
    this.path = path ?? join(homedir(), '.midi-mapper', 'state.json');
  }

  async load(): Promise<AppState> {
    try {
      const raw = await Bun.file(this.path).text();
      const parsed = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return {};
      }
      const result: Record<string, unknown> = {};
      if (typeof parsed.lastDevice === 'string') {
        result.lastDevice = parsed.lastDevice;
      }
      const validModes = ['local', 'host', 'join'];
      if (typeof parsed.lastMode === 'string' && validModes.includes(parsed.lastMode)) {
        result.lastMode = parsed.lastMode;
      }
      return result as AppState;
    } catch {
      return {};
    }
  }

  async save(state: AppState): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const data: Record<string, string> = {};
    if (state.lastDevice !== undefined) {
      data.lastDevice = state.lastDevice;
    }
    if (state.lastMode !== undefined) {
      data.lastMode = state.lastMode;
    }
    await Bun.write(this.path, JSON.stringify(data));
  }
}
