import type { ConfigEditorPort } from '@ports/config-editor.port';
import { createContext } from 'react';
import type { TuiStore } from './tui-store';

export const StoreContext = createContext<TuiStore | null>(null);
export const EditorContext = createContext<ConfigEditorPort | null>(null);
