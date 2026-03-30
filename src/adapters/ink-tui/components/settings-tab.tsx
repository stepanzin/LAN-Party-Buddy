import type { AppMode } from '@domain/config';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { useContext, useState } from 'react';
import { EditorContext, StoreContext } from '../context';
import { useTuiStore } from '../hooks/use-tui-store';

const MODES: AppMode[] = ['local', 'host', 'join'];

const MODE_DESC: Record<AppMode, string> = {
  local: 'Controller → Mapper → Virtual Port',
  host: 'Virtual Port → Mapper → Network',
  join: 'Network → Mapper → Virtual Port',
};

type Field = 'mode' | 'deviceName';

export function SettingsTab() {
  const store = useContext(StoreContext);
  const editor = useContext(EditorContext);
  const state = useTuiStore(store);
  const config = state.config;
  const [focusedField, setFocusedField] = useState<Field>('mode');
  const [editing, setEditing] = useState(false);
  const [fieldValue, setFieldValue] = useState('');

  useInput((input, key) => {
    if (editing) {
      if (key.return && fieldValue.trim().length > 0) {
        editor?.updateDeviceName(fieldValue.trim());
        setEditing(false);
      }
      if (key.escape) {
        setEditing(false);
      }
      return;
    }

    // Field navigation
    if (key.upArrow) setFocusedField('mode');
    if (key.downArrow) setFocusedField('deviceName');

    // Mode cycling with ←→
    if (focusedField === 'mode' && config) {
      if (key.leftArrow || key.rightArrow) {
        const idx = MODES.indexOf(config.mode);
        const dir = key.rightArrow ? 1 : -1;
        const newMode = MODES[(idx + dir + MODES.length) % MODES.length] ?? 'local';

        // Update config via editor service
        const updated = { ...config, mode: newMode };
        // Use raw config update through editor internals
        if (editor) {
          // updateDeviceName triggers onConfigChanged — we need a generic update
          // For now: save entire config with new mode
          (editor as any).config = updated;
          (editor as any).onConfigChanged?.(updated);
        }
        return;
      }
    }

    // DeviceName editing
    if (focusedField === 'deviceName' && key.return) {
      setFieldValue(config?.deviceName ?? '');
      setEditing(true);
    }

    // Save
    if (input === 's' && editor) {
      editor
        .saveConfig('config.yaml')
        .then(() => {
          store.setSaveStatus('Config saved ✓');
        })
        .catch((err: Error) => {
          store.setSaveStatus(`Save failed: ${err.message}`);
        });
    }
  });

  if (!config) {
    return <Text dimColor>No config loaded</Text>;
  }

  const modeChanged = config.mode !== state.mode;

  return (
    <Box flexDirection="column">
      <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1} paddingY={1}>
        <Box>
          <Text color={focusedField === 'mode' ? 'cyan' : undefined} bold={focusedField === 'mode'}>
            {focusedField === 'mode' ? '▸ ' : '  '}Mode: ◀ {config.mode} ▸
          </Text>
        </Box>
        <Box paddingLeft={14}>
          <Text dimColor>{MODE_DESC[config.mode]}</Text>
        </Box>
        {modeChanged && (
          <Box paddingLeft={4}>
            <Text color="yellow">Restart required to apply mode change. Press [S] to save.</Text>
          </Box>
        )}

        <Box marginTop={1}>
          <Text color={focusedField === 'deviceName' ? 'cyan' : undefined} bold={focusedField === 'deviceName'}>
            {focusedField === 'deviceName' ? '▸ ' : '  '}
            {editing ? (
              <>
                Device: <TextInput value={fieldValue} onChange={setFieldValue} />
              </>
            ) : (
              <>Device: {config.deviceName}</>
            )}
          </Text>
        </Box>

        <Box marginTop={1}>
          <Text dimColor>
            {editing ? '[Enter] Apply  [Esc] Cancel' : '[↑↓] Fields  [←→] Cycle mode  [Enter] Edit name  [S] Save'}
          </Text>
        </Box>
        {state.saveStatus && (
          <Box marginTop={1}>
            <Text color={state.saveStatus.includes('failed') ? 'red' : 'green'}>{state.saveStatus}</Text>
          </Box>
        )}
      </Box>
      {state.mode === 'host' && (
        <Box marginTop={1} flexDirection="column">
          <Text bold>Network</Text>
          <Text>
            Port: <Text color="cyan">{state.hostPort ?? 9900}</Text>
          </Text>
          <Text>
            Access: <Text color="cyan">{state.hostAccessMode === 'pin' ? `PIN: ${state.hostPin}` : 'Open'}</Text>
          </Text>
        </Box>
      )}
      {state.mode === 'join' && state.connectedHost && (
        <Box marginTop={1} flexDirection="column">
          <Text bold>Network</Text>
          <Text>
            Host: <Text color="cyan">{state.connectedHost.name}</Text>
          </Text>
          <Text>
            Address:{' '}
            <Text color="cyan">
              {state.connectedHost.address}:{state.connectedHost.port}
            </Text>
          </Text>
        </Box>
      )}
    </Box>
  );
}
