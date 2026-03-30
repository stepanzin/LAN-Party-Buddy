import type { AppConfig } from '@domain/config';

export interface ConfigWriterPort {
  save(path: string, config: AppConfig): Promise<void>;
}
