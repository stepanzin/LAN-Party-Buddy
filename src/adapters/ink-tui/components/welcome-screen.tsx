import React, { useState } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import figlet from 'figlet';

// @ts-ignore — Bun embeds this file into the binary via { type: "file" }
import calvinSPath from '../calvin-s.flf' with { type: 'file' };
const calvinSFont = await Bun.file(calvinSPath).text();
figlet.parseFont('Calvin S', calvinSFont);

import type { WelcomeChoice } from '@ports/user-interface.port';

type Props = {
  onSelect: (choice: WelcomeChoice) => void;
};

const ASCII_TITLE = figlet.textSync('MIDI Mapper', { font: 'Calvin S' });

const MENU_ITEMS = [
  { key: 'local' as const, label: 'Local Mode', desc: 'Controller \u2192 Mapper \u2192 Virtual Port', available: true },
  { key: 'host' as const, label: 'Host Mode', desc: 'Virtual Port \u2192 Mapper \u2192 Network broadcast', available: true },
  { key: 'join' as const, label: 'Join Mode', desc: 'Network \u2192 Mapper \u2192 Virtual Port', available: true },
];

export function WelcomeScreen({ onSelect }: Props) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const { exit } = useApp();

  useInput((input, key) => {
    if (key.upArrow) setSelectedIndex(Math.max(0, selectedIndex - 1));
    if (key.downArrow) setSelectedIndex(Math.min(MENU_ITEMS.length - 1, selectedIndex + 1));

    if (key.return) {
      const item = MENU_ITEMS[selectedIndex]!;
      if (item.available) {
        onSelect(item.key);
      }
    }

    if (input === 'q') {
      exit();
      process.exit(0);
    }
  });

  return (
    <Box flexDirection="column" alignItems="center" padding={1}>
      <Box flexDirection="column">
        <Text color="cyan">{ASCII_TITLE}</Text>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>Welcome! Select a mode to get started:</Text>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        {MENU_ITEMS.map((item, i) => {
          const selected = i === selectedIndex;
          const disabled = !item.available;

          return (
            <Box key={item.key} flexDirection="column" marginTop={i > 0 ? 1 : 0}>
              <Box>
                <Text color={disabled ? 'gray' : selected ? 'cyan' : 'white'} bold={selected}>
                  {selected ? '▸ ' : '  '}{item.label}
                </Text>
                {disabled && <Text color="gray" dimColor> (coming soon)</Text>}
              </Box>
              <Box paddingLeft={4}>
                <Text dimColor>{item.desc}</Text>
              </Box>
            </Box>
          );
        })}
      </Box>

      <Box marginTop={2}>
        <Text dimColor>[↑↓] Navigate  [Enter] Select  [Q] Quit</Text>
      </Box>
    </Box>
  );
}
