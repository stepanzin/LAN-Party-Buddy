import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

type Props = {
  hostName: string;
  onSubmit: (pin: string) => void;
  onCancel: () => void;
};

export function PinEntry({ hostName, onSubmit, onCancel }: Props) {
  const [digits, setDigits] = useState('');

  useInput((input, key) => {
    if (key.escape) { onCancel(); return; }
    if (key.return && digits.length === 4) { onSubmit(digits); return; }
    if (key.backspace || key.delete) { setDigits(d => d.slice(0, -1)); return; }
    if (input >= '0' && input <= '9' && digits.length < 4) {
      setDigits(d => d + input);
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold>Connect to: {hostName}</Text>
      <Box marginTop={1}>
        <Text>Enter PIN: </Text>
        <Text color="cyan" bold>
          {digits.padEnd(4, '_').split('').join(' ')}
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>[0-9] Enter digits  [Enter] Connect  [Esc] Cancel</Text>
      </Box>
    </Box>
  );
}
