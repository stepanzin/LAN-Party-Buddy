import React, { useContext } from 'react';
import { Box, Text } from 'ink';
import { StoreContext } from '../context';
import { useTuiStore } from '../hooks/use-tui-store';

export function JoinStatus() {
  const store = useContext(StoreContext);
  const state = useTuiStore(store);

  if (!state.connectedHost) {
    return <Text dimColor>Not connected to any host</Text>;
  }

  return (
    <Box gap={2}>
      <Text>Host: <Text color="cyan">{state.connectedHost.name}</Text></Text>
      <Text dimColor>({state.connectedHost.address}:{state.connectedHost.port})</Text>
    </Box>
  );
}
