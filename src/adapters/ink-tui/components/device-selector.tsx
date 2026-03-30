import type { MidiDevice } from '@ports/device-discovery.port';
import { Box, Text } from 'ink';
import SelectInput from 'ink-select-input';
import { useContext } from 'react';
import { StoreContext } from '../context';

export function DeviceSelector({ devices }: { devices: MidiDevice[] }) {
  const store = useContext(StoreContext);

  const items = devices.map((d) => ({
    label: d.name,
    value: d.index,
  }));

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold>Select MIDI input device:</Text>
      <Box marginTop={1}>
        <SelectInput items={items} onSelect={(item) => store.resolveDeviceSelection(item.value)} />
      </Box>
    </Box>
  );
}
