# LAN Party Buddy

Map, transform, and share MIDI controller signals over LAN.

## What is LAN Party Buddy?

A terminal UI application that maps MIDI CC messages from hardware controllers, applies configurable value transformations, and optionally shares controller signals across a local network. Built for musicians who need flexible MIDI routing -- solo or with friends.

Three operating modes:

- **Local Mode** -- Physical controller -> Mapper -> Virtual MIDI port -> DAW. Standard solo setup.
- **Host Mode** -- Virtual port -> Mapper -> Network broadcast. Share your controller with others on the LAN.
- **Join Mode** -- Network -> Mapper -> Virtual MIDI port -> DAW. Receive a remote controller as if it were local.

## Features

**Mapping**
- 4 curve types: linear, logarithmic, exponential, s-curve
- Smoothing via sliding average window
- Toggle mode (momentary button -> latching on/off)
- Dead zones (min/max clamping thresholds)
- Value inversion
- Macros: one input CC fans out to multiple output CCs

**Workflow**
- MIDI Learn: press L, turn a knob, CC number captured automatically
- Auto-reconnect when a device disconnects
- Config hot-reload: edit rules in the TUI, changes apply instantly
- YAML configuration files

**Network**
- mDNS auto-discovery of hosts on LAN
- PIN authentication for network sessions
- TCP transport with heartbeat keepalive

**TUI**
- Real-time terminal interface with 4 tabs: Monitor, Editor, Log, Settings
- Inline config editor with field navigation
- Welcome screen with mode selection on first run

## Quick Start

```bash
# Install dependencies
bun install

# Run (TUI starts automatically)
bun run start

# Run with a custom config file
bun run start -- --config my-config.yaml

# Run in a specific mode
bun run start -- --mode host

# Compile a standalone binary
bun run compile
./build/lan-party-buddy
```

## Configuration

All settings live in `config.yaml` (created on first run if missing).

```yaml
deviceName: "MIDI Mapper Output"

rules:
  - cc: 4                    # MIDI CC number (0-127)
    label: "Expression Pedal" # human-readable name
    inputMin: 40              # raw values below this clamp to inputMin
    inputMax: 127             # raw values above this clamp to inputMax
    outputMin: 0              # mapped output range start
    outputMax: 127            # mapped output range end
    curve: linear             # linear | logarithmic | exponential | s-curve
    smoothing: 3              # sliding average window size (0 = off)
    invert: false             # reverse output direction
    mode: normal              # normal | toggle
    deadZoneMin: 0            # values below -> clamped to inputMin
    deadZoneMax: 127          # values above -> clamped to inputMax

  - cc: 64
    label: "Sustain Toggle"
    inputMin: 0
    inputMax: 127
    outputMin: 0
    outputMax: 127
    curve: linear
    mode: toggle

macros:
  - input: 1                  # source CC number
    label: "Performance Macro"
    outputs:
      - cc: 74
        label: "Filter Cutoff"
        outputMin: 0
        outputMax: 127
        curve: exponential
      - cc: 71
        label: "Resonance"
        outputMin: 100
        outputMax: 20
        curve: linear
        invert: true

network:
  port: 9900                  # TCP port for host/join
  pin: "1234"                 # 4-char PIN (omit for open access)
  hostName: "My MIDI Mapper"  # mDNS advertised name
```

## TUI Controls

| Context       | Key          | Action                            |
|---------------|--------------|-----------------------------------|
| Global        | 1-4 / Tab    | Switch tabs                       |
| Global        | QQ           | Quit                              |
| Monitor       | A            | Add unmapped CC as new rule       |
| Editor (list) | Up/Down      | Browse rules                      |
| Editor (list) | Enter        | Edit selected rule                |
| Editor (list) | A            | Add new rule                      |
| Editor (list) | N            | Add new macro                     |
| Editor (edit) | Up/Down      | Navigate fields                   |
| Editor (edit) | Left/Right   | Cycle curve type or mode          |
| Editor (edit) | L            | MIDI Learn (turn knob to capture) |
| Editor (edit) | I            | Toggle invert                     |
| Editor (edit) | S            | Save rule                         |
| Editor (edit) | D            | Delete rule                       |
| Editor (edit) | Esc          | Back without saving               |
| Log           | C            | Clear log                         |
| Settings      | Enter        | Edit device name                  |
| Settings      | S            | Save settings                     |

## Network Modes

Host mode broadcasts MIDI data over TCP so other machines on the LAN can receive it. Join mode connects to a host and pipes incoming MIDI to a local virtual port.

```bash
# Machine A (has the physical controller)
bun run start -- --mode host

# Machine B (has the DAW)
bun run start -- --mode join
```

Join mode uses mDNS to discover available hosts automatically. If a PIN is configured on the host, joining clients must enter it before receiving data.

## Architecture

```
src/
  domain/     -- pure functions, zero I/O (curves, mapping engine, config types)
  ports/      -- interfaces defining contracts (MidiInput, MidiOutput, etc.)
  adapters/   -- implementations (MIDI I/O, TUI, network, YAML, JSON state)
  app/        -- orchestrator wiring ports to adapters
```

The project follows hexagonal architecture (ports and adapters). The domain layer contains only pure functions with no side effects -- all I/O lives in adapters that implement port interfaces. This makes the core logic fully testable without mocks.

## Contributing

**Prerequisites:** Bun 1.3.3+

```bash
bun install
bun test              # 659+ tests
bun test --coverage   # 100% line coverage target
bun run check         # Biome lint + format
```

**Import aliases:** `@domain/`, `@ports/`, `@adapters/`, `@app/`

**Conventions:**
- `fp-ts` for functional composition (`pipe`, `flow`, `Option`, `Record`)
- Domain layer: pure functions, state-in/state-out, no I/O
- Adapters: the only place that imports external libraries
- Strict TypeScript: `noUncheckedIndexAccess`, `noFallthroughCasesInSwitch`
- Bun test runner with `describe`/`it` blocks; tests mirror `src/` structure

## Tech Stack

| Dependency       | Role                          |
|------------------|-------------------------------|
| Bun              | Runtime, bundler, test runner |
| TypeScript       | Language (strict, ESNext)     |
| Ink / React      | Terminal UI framework         |
| @julusian/midi   | MIDI I/O (hardware + virtual) |
| fp-ts            | Functional programming        |
| bonjour-service  | mDNS discovery                |
| yaml             | Configuration parsing         |
| fast-check       | Property-based testing        |

## License

MIT
