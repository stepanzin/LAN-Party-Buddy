import React, { useContext, useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { StoreContext, EditorContext } from '../context';
import { useTuiStore } from '../hooks/use-tui-store';
import type { Curve, Mode } from '../../../domain/config';

const CURVES: Curve[] = ['linear', 'logarithmic', 'exponential', 's-curve'];
const MODES: Mode[] = ['normal', 'toggle'];

const CURVE_PREVIEW: Record<Curve, string> = {
  'linear': '╱',
  'logarithmic': '╱‾',
  'exponential': '_╱',
  's-curve': '_⌐',
};

type EditorMode = 'view' | 'edit' | 'edit-field';

const FIELDS = ['cc', 'label', 'inputMin', 'inputMax', 'outputMin', 'outputMax', 'curve', 'smoothing', 'invert', 'mode'] as const;
type FieldName = typeof FIELDS[number];

export function EditorTab() {
  const store = useContext(StoreContext);
  const editor = useContext(EditorContext);
  const state = useTuiStore(store);
  const config = state.config;
  const [mode, setMode] = useState<EditorMode>('view');
  const [focusedField, setFocusedField] = useState<number>(0);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [fieldValue, setFieldValue] = useState('');

  const selectedIndex = state.selectedRuleIndex;
  const selectedRule = config?.rules[selectedIndex];
  const selectedMacroIndex = state.selectedMacroIndex;
  const macros = config?.macros ?? [];

  const currentField = FIELDS[focusedField]!;

  const applyFieldEdit = useCallback(() => {
    if (!selectedRule || !editor || !editingField) return;
    const val = fieldValue.trim();
    const num = Number(val);

    switch (editingField) {
      case 'label':
        if (val.length > 0) editor.updateRule(selectedIndex, { ...selectedRule, label: val });
        break;
      case 'cc':
        if (Number.isInteger(num) && num >= 0 && num <= 127) editor.updateRule(selectedIndex, { ...selectedRule, cc: num });
        break;
      case 'inputMin':
        if (Number.isFinite(num)) editor.updateRule(selectedIndex, { ...selectedRule, inputMin: num });
        break;
      case 'inputMax':
        if (Number.isFinite(num)) editor.updateRule(selectedIndex, { ...selectedRule, inputMax: num });
        break;
      case 'outputMin':
        if (Number.isFinite(num)) editor.updateRule(selectedIndex, { ...selectedRule, outputMin: num });
        break;
      case 'outputMax':
        if (Number.isFinite(num)) editor.updateRule(selectedIndex, { ...selectedRule, outputMax: num });
        break;
      case 'smoothing':
        if (Number.isInteger(num) && num >= 0) editor.updateRule(selectedIndex, { ...selectedRule, smoothing: num });
        break;
    }
  }, [selectedRule, editor, editingField, fieldValue, selectedIndex]);

  const getFieldValue = (field: FieldName): string => {
    if (!selectedRule) return '';
    switch (field) {
      case 'cc': return String(selectedRule.cc);
      case 'label': return selectedRule.label;
      case 'inputMin': return String(selectedRule.inputMin);
      case 'inputMax': return String(selectedRule.inputMax);
      case 'outputMin': return String(selectedRule.outputMin);
      case 'outputMax': return String(selectedRule.outputMax);
      case 'curve': return selectedRule.curve;
      case 'smoothing': return String(selectedRule.smoothing ?? 0);
      case 'invert': return selectedRule.invert ? 'Yes' : 'No';
      case 'mode': return selectedRule.mode ?? 'normal';
    }
  };

  useInput((input, key) => {
    // MIDI Learn takes priority
    if (state.midiLearnActive) {
      if (key.escape) editor?.cancelMidiLearn();
      return;
    }

    // Field editing takes priority
    if (mode === 'edit-field') {
      if (key.return) {
        applyFieldEdit();
        setEditingField(null);
        setMode('edit');
      }
      if (key.escape) {
        setEditingField(null);
        setMode('edit');
      }
      return;
    }

    // ---- VIEW mode: browse rules ----
    if (mode === 'view') {
      if (key.upArrow && config) {
        store.setSelectedRuleIndex(Math.max(0, selectedIndex - 1));
      }
      if (key.downArrow && config) {
        store.setSelectedRuleIndex(Math.min(config.rules.length - 1, selectedIndex + 1));
      }
      if (key.return && selectedRule) {
        setMode('edit');
        setFocusedField(0);
      }
      if (input === 'a' && editor) {
        editor.addRule({
          cc: 0, label: 'New Rule', inputMin: 0, inputMax: 127,
          outputMin: 0, outputMax: 127, curve: 'linear',
        });
        store.setSelectedRuleIndex(config ? config.rules.length : 0);
        setMode('edit');
        setFocusedField(0);
      }
      if (input === 'n' && editor) {
        editor.addMacro({
          input: 0, label: 'New Macro',
          outputs: [{ cc: 0, label: 'Output', outputMin: 0, outputMax: 127, curve: 'linear' }],
        });
        store.setSelectedMacroIndex(macros.length);
      }
      if (input === 'D' && editor && macros.length > 0) {
        editor.deleteMacro(selectedMacroIndex);
        store.setSelectedMacroIndex(Math.max(0, selectedMacroIndex - 1));
      }
      return;
    }

    // ---- EDIT mode: navigate fields ----
    if (key.escape) {
      setMode('view');
      setFocusedField(0);
      return;
    }

    // Field navigation with ↑↓
    if (key.upArrow) {
      setFocusedField(Math.max(0, focusedField - 1));
      return;
    }
    if (key.downArrow) {
      setFocusedField(Math.min(FIELDS.length - 1, focusedField + 1));
      return;
    }

    // Field-specific actions
    if (currentField === 'cc' && input === 'l' && editor) {
      store.setMidiLearnActive(true);
      editor.startMidiLearn().then((cc) => {
        store.setMidiLearnCaptured(cc);
        if (selectedRule) editor.updateRule(selectedIndex, { ...selectedRule, cc });
      }).catch(() => {
        store.setMidiLearnActive(false);
      });
      return;
    }

    if (currentField === 'curve' && selectedRule && editor) {
      if (key.leftArrow) {
        const idx = CURVES.indexOf(selectedRule.curve);
        editor.updateRule(selectedIndex, { ...selectedRule, curve: CURVES[(idx - 1 + CURVES.length) % CURVES.length]! });
        return;
      }
      if (key.rightArrow) {
        const idx = CURVES.indexOf(selectedRule.curve);
        editor.updateRule(selectedIndex, { ...selectedRule, curve: CURVES[(idx + 1) % CURVES.length]! });
        return;
      }
    }

    if (currentField === 'invert' && selectedRule && editor) {
      if (key.return || key.leftArrow || key.rightArrow) {
        editor.updateRule(selectedIndex, { ...selectedRule, invert: !selectedRule.invert });
        return;
      }
    }

    if (currentField === 'mode' && selectedRule && editor) {
      if (key.return || key.leftArrow || key.rightArrow) {
        const idx = MODES.indexOf(selectedRule.mode ?? 'normal');
        editor.updateRule(selectedIndex, { ...selectedRule, mode: MODES[(idx + 1) % MODES.length]! });
        return;
      }
    }

    // Enter on editable text/number field → edit-field mode
    if (key.return && selectedRule) {
      const editableFields = ['cc', 'label', 'inputMin', 'inputMax', 'outputMin', 'outputMax', 'smoothing'];
      if (editableFields.includes(currentField)) {
        setEditingField(currentField);
        setFieldValue(getFieldValue(currentField));
        setMode('edit-field');
        return;
      }
    }

    // Global edit-mode shortcuts
    if (input === 's' && editor) {
      editor.saveConfig('config.yaml').then(() => {
        store.setSaveStatus('Config saved ✓');
      }).catch((err: Error) => {
        store.setSaveStatus(`Save failed: ${err.message}`);
      });
    }
    if (input === 'd' && editor && config && config.rules.length > 0) {
      editor.deleteRule(selectedIndex);
      store.setSelectedRuleIndex(Math.max(0, selectedIndex - 1));
    }
    if (input === 'a' && editor) {
      editor.addRule({
        cc: 0, label: 'New Rule', inputMin: 0, inputMax: 127,
        outputMin: 0, outputMax: 127, curve: 'linear',
      });
      store.setSelectedRuleIndex(config ? config.rules.length : 0);
    }
    if (input === 'n' && editor) {
      editor.addMacro({
        input: 0, label: 'New Macro',
        outputs: [{ cc: 0, label: 'Output', outputMin: 0, outputMax: 127, curve: 'linear' }],
      });
      store.setSelectedMacroIndex(macros.length);
    }
    if (input === 'D' && editor && macros.length > 0) {
      editor.deleteMacro(selectedMacroIndex);
      store.setSelectedMacroIndex(Math.max(0, selectedMacroIndex - 1));
    }
  });

  if (!config) {
    return <Text dimColor>No config loaded</Text>;
  }

  const isEditing = mode === 'edit' || mode === 'edit-field';

  function renderField(field: FieldName, label: string, value: string, extra?: string) {
    const focused = isEditing && currentField === field;
    const prefix = focused ? '▸ ' : '  ';

    if (mode === 'edit-field' && editingField === field) {
      return (
        <Box>
          <Text color="cyan">{prefix}{label.padEnd(11)}</Text>
          <TextInput value={fieldValue} onChange={setFieldValue} />
        </Box>
      );
    }

    return (
      <Box>
        <Text color={focused ? 'cyan' : undefined} bold={focused}>
          {prefix}{label.padEnd(11)}{value}
        </Text>
        {extra && <Text dimColor>  {extra}</Text>}
      </Box>
    );
  }

  return (
    <Box>
      {/* Left: Rule list */}
      <Box flexDirection="column" width="50%">
        <Text bold dimColor>Rules</Text>
        {config.rules.map((rule, i) => (
          <Text key={i} color={i === selectedIndex ? 'cyan' : 'gray'} bold={i === selectedIndex}>
            {i === selectedIndex ? '▸' : ' '} [{i + 1}] CC {rule.cc.toString().padStart(3)}  {rule.label.slice(0, 18).padEnd(18)}  {rule.curve}
          </Text>
        ))}
        <Box marginTop={1} flexDirection="column">
          <Text bold dimColor>Macros</Text>
          {macros.map((macro, i) => (
            <Text key={`macro-${i}`} color={i === selectedMacroIndex ? 'cyan' : 'gray'} dimColor={i !== selectedMacroIndex}>
              {i === selectedMacroIndex ? '▸' : ' '} CC {macro.input.toString().padStart(3)} → {macro.outputs.map(o => `CC${o.cc}`).join(', ')}  {macro.label}
            </Text>
          ))}
        </Box>
        <Box marginTop={1}>
          <Text color="gray">  [A] Add rule  [N] Add macro  [Enter] Edit</Text>
        </Box>
      </Box>

      {/* Right: Rule detail / edit form */}
      <Box flexDirection="column" width="50%" borderStyle="single" borderColor={isEditing ? 'cyan' : 'gray'} paddingX={1}>
        {selectedRule ? (
          <>
            <Box>
              <Text bold>Rule {selectedIndex + 1}</Text>
              <Text color={isEditing ? 'cyan' : 'gray'}> {isEditing ? '[EDIT]' : '[VIEW]'}</Text>
            </Box>

            {state.midiLearnActive ? (
              <Box marginTop={1}>
                <Text color="yellow">Waiting for MIDI signal... [Esc] cancel</Text>
              </Box>
            ) : (
              <Box flexDirection="column" marginTop={1}>
                {renderField('cc', 'CC:', String(selectedRule.cc),
                  isEditing && currentField === 'cc' ? '[L] MIDI Learn  [Enter] Edit' : undefined)}
                {renderField('label', 'Label:', selectedRule.label,
                  isEditing && currentField === 'label' ? '[Enter] Edit' : undefined)}
                {renderField('inputMin', 'Input Min:', String(selectedRule.inputMin))}
                {renderField('inputMax', 'Input Max:', String(selectedRule.inputMax))}
                {renderField('outputMin', 'Output Min:', String(selectedRule.outputMin))}
                {renderField('outputMax', 'Output Max:', String(selectedRule.outputMax))}
                {renderField('curve', 'Curve:', `${isEditing ? '◀ ' : ''}${selectedRule.curve}${isEditing ? ' ▸' : ''}`,
                  CURVE_PREVIEW[selectedRule.curve])}
                {renderField('smoothing', 'Smooth:', String(selectedRule.smoothing ?? 0))}
                {renderField('invert', 'Invert:', selectedRule.invert ? 'Yes' : 'No')}
                {renderField('mode', 'Mode:', selectedRule.mode ?? 'normal')}
              </Box>
            )}

            <Box marginTop={1}>
              {isEditing ? (
                <Text dimColor>[↑↓] Fields  [Esc] Back  [S]ave  [D]el  [Enter] Edit field</Text>
              ) : (
                <Text dimColor>[↑↓] Rules  [Enter] Edit  [A] Add  [N] Macro</Text>
              )}
            </Box>
            {state.saveStatus && (
              <Text color={state.saveStatus.includes('failed') ? 'red' : 'green'}>{state.saveStatus}</Text>
            )}
          </>
        ) : (
          <Text dimColor>No rule selected</Text>
        )}
      </Box>
    </Box>
  );
}
