import React, { useContext, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { StoreContext, EditorContext } from '../context';
import { useTuiStore } from '../hooks/use-tui-store';

export function SettingsTab() {
  const store = useContext(StoreContext);
  const editor = useContext(EditorContext);
  const state = useTuiStore(store);
  const config = state.config;
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

    if (key.return) {
      setFieldValue(config?.deviceName ?? '');
      setEditing(true);
    }

    if (input === 's' && editor) {
      editor.saveConfig('config.yaml').then(() => {
        store.setSaveStatus('Config saved \u2713');
      }).catch((err: Error) => {
        store.setSaveStatus(`Save failed: ${err.message}`);
      });
    }
  });

  if (!config) {
    return <Text dimColor>No config loaded</Text>;
  }

  return (
    <Box flexDirection="column">
      <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1} paddingY={1}>
        <Text bold>Virtual MIDI Port</Text>

        {editing ? (
          <Box marginTop={1}>
            <Text>Name: </Text>
            <TextInput value={fieldValue} onChange={setFieldValue} />
          </Box>
        ) : (
          <Box marginTop={1}>
            <Text>Name: </Text>
            <Text color="cyan">{config.deviceName}</Text>
          </Box>
        )}

        <Box marginTop={1}>
          <Text dimColor>
            {editing
              ? '[Enter] Apply  [Esc] Cancel'
              : '[Enter] Edit  [S] Save config'}
          </Text>
        </Box>

        <Box marginTop={1}>
          <Text color="yellow" dimColor>
            Changing the name will reconnect the virtual port.
          </Text>
        </Box>
        {state.saveStatus && (
          <Box marginTop={1}>
            <Text color={state.saveStatus.includes('failed') ? 'red' : 'green'}>{state.saveStatus}</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}
