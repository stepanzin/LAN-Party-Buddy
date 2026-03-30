import React, { useContext } from 'react';
import { Box, Text } from 'ink';
import SelectInput from 'ink-select-input';
import { StoreContext } from '../context';
import type { MidiDevice } from '@ports/device-discovery.port';

export function DeviceSelector({ devices }: { devices: MidiDevice[] }) {
  const store = useContext(StoreContext);

  const items = devices.map(d => ({
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
