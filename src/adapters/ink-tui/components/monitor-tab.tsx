import React, { useContext } from 'react';
import { Box, Text, useInput } from 'ink';
import { StoreContext, EditorContext } from '../context';
import { useTuiStore } from '../hooks/use-tui-store';

function renderBar(value: number, width = 15): string {
  const filled = Math.round((value / 127) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

export function MonitorTab() {
  const store = useContext(StoreContext);
  const editor = useContext(EditorContext);
  const state = useTuiStore(store);
  const config = state.config;

  useInput((input) => {
    if (input === 'a' && editor && state.unmapped.size > 0) {
      // Get most recent unmapped CC
      const entries = Array.from(state.unmapped.values());
      const mostRecent = entries.sort((a, b) => b.lastSeen - a.lastSeen)[0]!;

      editor.addRule({
        cc: mostRecent.cc,
        label: `CC ${mostRecent.cc}`,
        inputMin: 0,
        inputMax: 127,
        outputMin: 0,
        outputMax: 127,
        curve: 'linear',
      });

      // Switch to editor and select the new rule
      store.setSelectedRuleIndex(config ? config.rules.length : 0);
      store.setTab('editor');
    }
  });

  // Build a map of CC -> last activity
  const lastActivity = new Map<number, { value: number; mappedValue: number; ruleLabel?: string }>();
  for (const a of state.activities) {
    lastActivity.set(a.cc, { value: a.value, mappedValue: a.mappedValue, ruleLabel: a.ruleLabel });
  }

  // Get recent timestamp for flash effect (activity within last 300ms)
  const now = Date.now();
  const recentCCs = new Set(
    state.activities.filter(a => now - a.timestamp < 300).map(a => a.cc)
  );

  return (
    <Box flexDirection="column">
      <Text bold dimColor>  Rules</Text>
      {config?.rules.map((rule, i) => {
        const activity = lastActivity.get(rule.cc);
        const active = recentCCs.has(rule.cc);
        const value = activity?.value ?? 0;
        const mapped = activity?.mappedValue ?? 0;

        return (
          <Box key={i} gap={1}>
            <Text color={active ? 'green' : 'white'}>
              {active ? '▸' : ' '} CC {rule.cc.toString().padStart(3)}
            </Text>
            <Text color={active ? 'green' : 'gray'}>
              {rule.label.padEnd(16).slice(0, 16)}
            </Text>
            <Text color={active ? 'green' : 'gray'}>
              {renderBar(mapped)}
            </Text>
            <Text color={active ? 'green' : 'gray'}>
              {value.toString().padStart(3)} → {mapped.toString().padStart(3)}
            </Text>
            <Text dimColor>{rule.curve}</Text>
            {rule.mode === 'toggle' && <Text color="yellow">toggle</Text>}
            {(rule.smoothing ?? 0) > 0 && <Text dimColor>sm:{rule.smoothing}</Text>}
          </Box>
        );
      })}

      {/* Macros */}
      {config?.macros && config.macros.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold dimColor>  Macros</Text>
          {config.macros.map((macro, i) => (
            <Box key={`macro-${i}`} flexDirection="column">
              <Text>  CC {macro.input.toString().padStart(3)}  {macro.label}</Text>
              {macro.outputs.map((out, j) => (
                <Text key={j} dimColor>    → CC {out.cc.toString().padStart(3)}  {out.label}</Text>
              ))}
            </Box>
          ))}
        </Box>
      )}

      {/* Unmapped */}
      {state.unmapped.size > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold dimColor>  Unmapped</Text>
          {Array.from(state.unmapped.values()).slice(-5).map((u) => (
            <Text key={u.cc} color="yellow">
              {'  '}? CC {u.cc.toString().padStart(3)}  value: {u.value}
            </Text>
          ))}
          <Text color="gray">  [A] Add most recent as rule</Text>
        </Box>
      )}

      {/* Network */}
      {state.mode === 'host' && state.connectedClients.length > 0 && (
        <>
          <Text bold dimColor>  Network</Text>
          {state.connectedClients.map(c => (
            <Text key={c.id} dimColor>   ● {c.address}</Text>
          ))}
        </>
      )}
      {state.mode === 'join' && state.connectedHost && (
        <>
          <Text bold dimColor>  Network</Text>
          <Text dimColor>   Connected: {state.connectedHost.name} ({state.connectedHost.address})</Text>
        </>
      )}
    </Box>
  );
}
