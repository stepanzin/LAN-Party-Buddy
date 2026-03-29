import { useSyncExternalStore } from 'react';
import type { TuiStore, TuiState } from '../tui-store';

export function useTuiStore(store: TuiStore): Readonly<TuiState> {
  return useSyncExternalStore(
    (listener) => store.subscribe(listener),
    () => store.getState(),
  );
}
