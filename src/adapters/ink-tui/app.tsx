import React from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { StoreContext, EditorContext } from './context';
import type { TuiStore } from './tui-store';
import type { ConfigEditorPort } from '../../ports/config-editor.port';
import { useTuiStore } from './hooks/use-tui-store';
import { MonitorTab } from './components/monitor-tab';
import { EditorTab } from './components/editor-tab';
import { LogTab } from './components/log-tab';
import { SettingsTab } from './components/settings-tab';
import { DeviceSelector } from './components/device-selector';
import { HostStatus } from './components/host-status';
import { JoinStatus } from './components/join-status';

type Props = {
  store: TuiStore;
  configEditor?: ConfigEditorPort;
};

export function App({ store, configEditor }: Props) {
  const state = useTuiStore(store);
  const { exit } = useApp();
  const [lastQuitTime, setLastQuitTime] = React.useState(0);
  const quitPending = Date.now() - lastQuitTime < 2000;

  const TAB_ORDER = ['monitor', 'editor', 'log', 'settings'] as const;

  useInput((input, key) => {
    if (input === 'q' && !state.midiLearnActive) {
      if (quitPending) {
        exit();
        process.exit(0);
      }
      setLastQuitTime(Date.now());
      return;
    }

    // Any other key clears quit hint (implicit via timeout)

    // Tab switching: 1/2/3 or Tab/Shift+Tab
    if (input === '1') store.setTab('monitor');
    if (input === '2') store.setTab('editor');
    if (input === '3') store.setTab('log');
    if (input === '4') store.setTab('settings');
    if (key.tab) {
      const idx = TAB_ORDER.indexOf(state.tab);
      const next = key.shift
        ? TAB_ORDER[(idx - 1 + TAB_ORDER.length) % TAB_ORDER.length]!
        : TAB_ORDER[(idx + 1) % TAB_ORDER.length]!;
      store.setTab(next);
    }
  });

  // If device selection is active, show selector overlay
  if (state.deviceSelectionDevices) {
    return (
      <StoreContext.Provider value={store}>
        <DeviceSelector devices={state.deviceSelectionDevices} />
      </StoreContext.Provider>
    );
  }

  const tabs = [
    { key: 'monitor', num: '1', label: 'Monitor' },
    { key: 'editor', num: '2', label: 'Editor' },
    { key: 'log', num: '3', label: 'Log' },
    { key: 'settings', num: '4', label: 'Settings' },
  ] as const;

  const uptime = Math.floor((Date.now() - state.startTime) / 1000);
  const mins = Math.floor(uptime / 60);
  const secs = uptime % 60;

  return (
    <StoreContext.Provider value={store}>
      <EditorContext.Provider value={configEditor ?? null}>
        <Box flexDirection="column">
          {/* Header */}
          <Box borderStyle="round" paddingX={1} justifyContent="space-between">
            <Box>
              <Text bold>LAN Party Buddy</Text>
              <Text color="gray"> [{state.mode.toUpperCase()}]</Text>
              {state.device && (
                <Text color="gray"> → {state.device}</Text>
              )}
              <Text color={state.connected ? 'green' : 'red'}> {state.connected ? '●' : '○'}</Text>
            </Box>
            <Box>
              <Text color="gray">↑{state.messageCount}msg  {mins}m{secs.toString().padStart(2, '0')}s</Text>
            </Box>
          </Box>
          {state.mode === 'host' && <HostStatus />}
          {state.mode === 'join' && <JoinStatus />}

          {/* Tab bar */}
          <Box gap={2} paddingX={1}>
            {tabs.map((t) => (
              <Text key={t.key} bold={state.tab === t.key} underline={state.tab === t.key} color={state.tab === t.key ? 'cyan' : 'gray'}>
                [{t.num}] {t.label}
              </Text>
            ))}
          </Box>

          {/* System message (errors, warnings) */}
          {state.systemMessage && (
            <Box paddingX={1} marginTop={1}>
              <Text color="red" bold>{state.systemMessage}</Text>
            </Box>
          )}

          {/* Active tab */}
          <Box flexDirection="column" paddingX={1} marginTop={1}>
            {state.tab === 'monitor' && <MonitorTab />}
            {state.tab === 'editor' && <EditorTab />}
            {state.tab === 'log' && <LogTab />}
            {state.tab === 'settings' && <SettingsTab />}
          </Box>

          {/* Footer */}
          <Box paddingX={1} marginTop={1}>
            {quitPending ? (
              <Text color="red" bold>Press Q again to quit</Text>
            ) : (
              <Text color="gray">[1-4/Tab] Switch tabs  [QQ] Quit</Text>
            )}
          </Box>
        </Box>
      </EditorContext.Provider>
    </StoreContext.Provider>
  );
}
