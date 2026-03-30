import { Box, Text } from 'ink';
import { useContext } from 'react';
import { StoreContext } from '../context';
import { useTuiStore } from '../hooks/use-tui-store';

export function HostStatus() {
  const store = useContext(StoreContext);
  const state = useTuiStore(store);

  return (
    <Box flexDirection="column">
      <Box gap={2}>
        <Text>
          Port: <Text color="cyan">{state.hostPort ?? '—'}</Text>
        </Text>
        <Text>
          PIN: <Text color="cyan">{state.hostPin ?? 'Open'}</Text>
        </Text>
        <Text>
          Clients: <Text color="cyan">{state.connectedClients.length}</Text>
        </Text>
      </Box>
      {state.connectedClients.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          {state.connectedClients.map((c) => (
            <Text key={c.id} dimColor>
              {' '}
              ● {c.address}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  );
}
