import { createContext } from 'react';
import type { TuiStore } from './tui-store';
import type { ConfigEditorPort } from '../../ports/config-editor.port';

export const StoreContext = createContext<TuiStore>(null!);
export const EditorContext = createContext<ConfigEditorPort | null>(null);
