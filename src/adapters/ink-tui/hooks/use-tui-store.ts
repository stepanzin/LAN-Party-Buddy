import { useSyncExternalStore } from 'react';
import type { TuiState, TuiStore } from '../tui-store';

export function useTuiStore(store: TuiStore): Readonly<TuiState> {
  return useSyncExternalStore(
    (listener) => store.subscribe(listener),
    () => store.getState(),
  );
}
