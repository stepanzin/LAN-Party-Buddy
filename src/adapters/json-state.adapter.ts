import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { mkdir } from 'node:fs/promises';
import type { StateStorePort, AppState } from '../ports/state-store.port';

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
      if (typeof parsed.lastDevice === 'string') {
        return { lastDevice: parsed.lastDevice };
      }
      return {};
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
    await Bun.write(this.path, JSON.stringify(data));
  }
}
