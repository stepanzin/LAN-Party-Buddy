import React, { useContext } from 'react';
import { Box, Text, useInput } from 'ink';
import { StoreContext } from '../context';
import { useTuiStore } from '../hooks/use-tui-store';

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}.${d.getMilliseconds().toString().padStart(3, '0')}`;
}

export function LogTab() {
  const store = useContext(StoreContext);
  const state = useTuiStore(store);

  useInput((input) => {
    if (input === 'c') {
      store.clearLog();
    }
  });

  if (state.logEntries.length === 0) {
    return (
      <Box flexDirection="column">
        <Text dimColor>No MIDI messages yet...</Text>
        <Box marginTop={1}>
          <Text dimColor>[C] Clear log</Text>
        </Box>
      </Box>
    );
  }

  // Show last 20 entries (terminal height limit)
  const entries = state.logEntries.slice(-20);

  return (
    <Box flexDirection="column">
      {entries.map((entry, i) => (
        <Box key={i} gap={1}>
          <Text dimColor>{formatTime(entry.timestamp)}</Text>
          <Text color={entry.matched ? 'green' : 'yellow'}>
            CC {entry.cc.toString().padStart(3)}
          </Text>
          <Text>
            {entry.originalValue.toString().padStart(3)} -&gt; {entry.mappedValue.toString().padStart(3)}
          </Text>
          {entry.ruleLabel && <Text dimColor>({entry.ruleLabel})</Text>}
          {!entry.matched && <Text color="yellow">unmapped</Text>}
          {entry.macroOutputs && entry.macroOutputs.length > 0 && (
            <Text dimColor>
              macro: {entry.macroOutputs.map(m => `CC${m.cc}:${m.value}`).join(', ')}
            </Text>
          )}
        </Box>
      ))}
      <Box marginTop={1}>
        <Text dimColor>[C] Clear log</Text>
      </Box>
    </Box>
  );
}
