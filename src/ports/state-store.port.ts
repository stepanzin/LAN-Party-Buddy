export type AppState = {
  readonly lastDevice?: string;
  readonly lastMode?: 'local' | 'host' | 'join';
};

export interface StateStorePort {
  load(): Promise<AppState>;
  save(state: AppState): Promise<void>;
}
