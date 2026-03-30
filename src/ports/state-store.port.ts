export type AppState = {
  readonly lastDevice?: string;
};

export interface StateStorePort {
  load(): Promise<AppState>;
  save(state: AppState): Promise<void>;
}
