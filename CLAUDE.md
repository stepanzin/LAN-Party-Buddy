# LAN Party Buddy

## Project Overview
MIDI mapping and sharing tool with 3 modes: Local (controller → virtual port), Host (virtual port → network broadcast), Join (network → virtual port). Terminal UI built with Ink/React.

## Tech Stack
- **Runtime**: Bun 1.3.3+
- **Language**: TypeScript (strict, ESNext)
- **Key deps**: `@julusian/midi` (MIDI I/O), `fp-ts` (functional patterns), `ink`/`react` (TUI), `yaml` (config), `bonjour-service` (mDNS), `figlet` (ASCII art)
- **Linting**: Biome (lint + format), Lefthook (pre-commit)

## Commands
- `bun run start` — run the app (loads `config.yaml` by default)
- `bun run start -- --config path/to/config.yaml` — use custom config
- `bun run start -- --mode host` — start in host/join/local mode
- `bun run compile` — build standalone binary for current platform
- `bun run compile:all` — build for Linux, macOS, Windows (x64 + arm64)
- `bun test` — run all tests (bun:test)
- `bun test --coverage` — run tests with coverage (must be 100% lines)
- `bun run check` — lint + format (Biome)
- `bun run lint` — lint only
- `bun run lint:fix` — lint + autofix

## Architecture — Hexagonal (Ports & Adapters)

```
src/
  index.ts                                — composition root: wires adapters → app

  domain/                                 — pure core, no I/O, no external deps
    config.ts                             — AppConfig, RuleConfig, Curve, NetworkConfig types
    midi-message.ts                       — MidiCC, parseMidiCC, toRawMessage
    value-curves.ts                       — mapValueClamped, mapValueLogClamped, exponential, s-curve
    mapping-rule.ts                       — CompiledRules, CompiledMacros types
    mapping-engine.ts                     — processMidiMessage (pure function)
    network-protocol.ts                   — TCP binary protocol encode/decode

  ports/                                  — interfaces (contracts)
    midi-input.port.ts                    — MidiInputPort
    midi-output.port.ts                   — MidiOutputPort
    device-discovery.port.ts              — DeviceDiscoveryPort
    user-interface.port.ts                — UserInterfacePort (lifecycle + welcome + device select)
    config-reader.port.ts                 — ConfigReaderPort
    config-writer.port.ts                 — ConfigWriterPort
    state-store.port.ts                   — StateStorePort (lastDevice + lastMode)
    monitor.port.ts                       — MonitorPort (real-time MIDI activity push)
    config-editor.port.ts                 — ConfigEditorPort (CRUD rules, MIDI learn)

  adapters/                               — port implementations
    julusian-midi.adapter.ts              — MidiInput + MidiOutput + DeviceDiscovery
    yaml-config.adapter.ts                — ConfigReader + ConfigWriter (YAML)
    json-state.adapter.ts                 — StateStore (~/.lan-party-buddy/state.json)
    ink-tui/                              — Ink/React TUI adapter
      ink-tui.adapter.ts                  — implements UserInterfacePort + MonitorPort
      tui-store.ts                        — reactive state (useSyncExternalStore)
      app.tsx                             — root component (tabs, header, footer)
      context.ts                          — React contexts
      hooks/use-tui-store.ts              — store hook
      components/                         — monitor-tab, editor-tab, log-tab, settings-tab,
                                            welcome-screen, device-selector, host-status,
                                            join-status, pin-entry
      calvin-s.flf                        — embedded figlet font
    network/                              — network mode adapters
      tcp-server.ts                       — Bun.listen TCP server
      tcp-client.ts                       — Bun.connect TCP client
      tcp-broadcast-output.adapter.ts     — implements MidiOutputPort (Host mode)
      tcp-client-input.adapter.ts         — implements MidiInputPort (Join mode)
      virtual-port-input.adapter.ts       — implements MidiInputPort (Host mode, virtual in)
      static-device-discovery.adapter.ts  — implements DeviceDiscoveryPort (Host mode)
      mdns-advertiser.adapter.ts          — mDNS service publish
      mdns-browser-discovery.adapter.ts   — implements DeviceDiscoveryPort (Join mode)

  app/                                    — application layer
    midi-mapper.app.ts                    — orchestrator: config → device loop → mapping
    rule-compiler.ts                      — buildRules, buildMacros (fp-ts flow)
    config-editor.service.ts              — MIDI learn, hot-reload, CRUD

tests/
  domain/           — pure unit tests (no mocks)
  adapters/         — adapter tests (filesystem I/O, mocked mDNS)
  app/              — app tests (all ports mocked)
  integration/      — real adapters + domain (no hardware mocks)
  e2e/              — full flows (real TCP, real config, real state)
  smoke/            — app doesn't crash (throughput, reconnect)
  pbt/              — property-based tests (fast-check)
  edge-cases/       — adversarial tests (NaN, duplicates, network stress)
  ink/              — ink-testing-library (keyboard interaction)
```

## Import Aliases
```
@domain/*   → src/domain/*
@ports/*    → src/ports/*
@adapters/* → src/adapters/*
@app/*      → src/app/*
```
Cross-layer imports MUST use aliases. Same-directory siblings use relative.

## Code Conventions
- Import aliases for cross-layer imports (no `../../src/`)
- `fp-ts` for functional composition (`pipe`, `flow`, `Option`, `Record`) — only in app layer
- Domain layer: zero I/O, zero external deps, pure functions, state-in/state-out
- Adapters: only place that imports external libraries
- Bun built-in test runner (`bun:test`) with `describe`/`it` blocks
- Tests mirror `src/` structure in `tests/`
- Comments in Russian are acceptable
- Biome: single quotes, 2-space indent, trailing commas, 120 line width
- No non-null assertions (`!`) in src/ — use nullish coalescing or guards
- No `{}` type — use `Record<string, never>`

## MIDI Basics
- CC message = 3 bytes: `[status, cc, value]`
- Status byte for CC: `0xB0 + channel` (0xB0–0xBF for channels 0–15)
- CC and value range: 0–127

## Network Protocol
- TCP: 4 bytes per message `[type, channel, cc, value]`
- Types: `0x01` CC, `0x02` heartbeat, `0xFF` disconnect
- PIN auth: client sends 4 ASCII bytes, server responds `0x01`/`0x00`
- mDNS service type: `_lan-party-buddy._tcp`
