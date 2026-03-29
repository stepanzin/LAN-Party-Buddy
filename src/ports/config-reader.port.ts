import type { AppConfig } from '../domain/config';

export interface ConfigReaderPort {
  load(source: string): Promise<AppConfig>;
}
