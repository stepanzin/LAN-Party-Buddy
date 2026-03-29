# MIDI Mapper Bun

## Project Overview
CLI MIDI mapper: reads CC messages from hardware MIDI controllers, applies configurable value transformations, outputs to a virtual MIDI port for DAW integration.

## Tech Stack
- **Runtime**: Bun 1.3.3+
- **Language**: TypeScript (strict, ESNext)
- **Key deps**: `@julusian/midi` (MIDI I/O), `fp-ts` (functional patterns), `@inquirer/prompts` (CLI), `yaml` (config)

## Commands
- `bun run start` — run the app (loads `config.yaml` by default)
- `bun run start -- --config path/to/config.yaml` — use custom config
- `bun run compile` — build standalone binary to `build/`
- `bun test` — run all tests (bun:test)
- `bun test --coverage` — run tests with coverage (must be 100% lines)

## Architecture — Hexagonal (Ports & Adapters)

```
index.ts                                — bootstrap: wires adapters, starts app
config.yaml                             — default mapping config (YAML)

src/
  domain/                               — pure core, no I/O
    config.ts                           — AppConfig, RuleConfig, Curve types
    midi-message.ts                     — MidiCC, parseMidiCC, toRawMessage
    value-curves.ts                     — mapValueClamped, mapValueLogClamped
    mapping-rule.ts                     — buildRules: config → CompiledRules
    mapping-engine.ts                   — processMidiMessage (pure function)

  ports/                                — interfaces (contracts)
    midi-input.port.ts                  — MidiInputPort
    midi-output.port.ts                 — MidiOutputPort
    device-discovery.port.ts            — DeviceDiscoveryPort
    user-interface.port.ts              — UserInterfacePort
    config-reader.port.ts               — ConfigReaderPort
    state-store.port.ts                 — StateStorePort

  adapters/                             — port implementations
    julusian-midi.adapter.ts            — MidiInput + MidiOutput + DeviceDiscovery
    inquirer-cli.adapter.ts             — UserInterface (CLI)
    yaml-config.adapter.ts              — ConfigReader (YAML)
    json-state.adapter.ts               — StateStore (~/.midi-mapper/state.json)

  app/
    midi-mapper.app.ts                  — orchestrator: config → device loop → mapping

tests/
  domain/                               — pure unit tests (no mocks)
  adapters/                             — adapter tests (filesystem I/O)
  app/                                  — app tests (all ports mocked)
```

## Code Conventions
- Use `fp-ts` for functional composition (`pipe`, `flow`, `Option`, `Record`)
- Curried function variants for use in `flow`/`pipe` pipelines
- Bun built-in test runner (`bun:test`) with `describe`/`it` blocks
- Tests mirror `src/` structure in `tests/`
- Comments in Russian are acceptable
- Strict TypeScript: `noUncheckedIndexAccess`, `noFallthroughCasesInSwitch`
- Domain layer: zero I/O, pure functions, state-in/state-out
- Adapters: only place that imports external libraries

## MIDI Basics
- CC message = 3 bytes: `[status, cc, value]`
- Status byte for CC: `0xB0 + channel` (0xB0–0xBF for channels 0–15)
- CC and value range: 0–127
