import { describe, expect, it, mock } from 'bun:test';
import { WelcomeScreen } from '@adapters/ink-tui/components/welcome-screen';
import { render } from 'ink-testing-library';
import React from 'react';

const tick = () => new Promise((r) => setTimeout(r, 30));

describe('Mode Select (WelcomeScreen)', () => {
  it('renders 3 mode options', () => {
    const onSelect = mock(() => {});
    const { lastFrame, unmount } = render(React.createElement(WelcomeScreen, { onSelect }));
    const frame = lastFrame();
    expect(frame).toContain('Local Mode');
    expect(frame).toContain('Host Mode');
    expect(frame).toContain('Join Mode');
    unmount();
  });

  it('all modes are available (none disabled)', () => {
    const onSelect = mock(() => {});
    const { lastFrame, unmount } = render(React.createElement(WelcomeScreen, { onSelect }));
    const frame = lastFrame();
    expect(frame).not.toContain('coming soon');
    unmount();
  });

  it('arrow navigation works', async () => {
    const onSelect = mock(() => {});
    const { lastFrame, stdin, unmount } = render(React.createElement(WelcomeScreen, { onSelect }));

    // Initially first item selected (Local Mode)
    expect(lastFrame()).toContain('▸');
    expect(lastFrame()).toMatch(/▸\s*Local Mode/);

    // Arrow down → Host Mode
    stdin.write('\x1b[B');
    await tick();
    expect(lastFrame()).toMatch(/▸\s*Host Mode/);

    // Arrow down → Join Mode
    stdin.write('\x1b[B');
    await tick();
    expect(lastFrame()).toMatch(/▸\s*Join Mode/);

    // Arrow down again → should not go past last item
    stdin.write('\x1b[B');
    await tick();
    expect(lastFrame()).toMatch(/▸\s*Join Mode/);

    // Arrow up → Host Mode
    stdin.write('\x1b[A');
    await tick();
    expect(lastFrame()).toMatch(/▸\s*Host Mode/);

    unmount();
  });

  it('Enter calls onSelect with "local" for first item', async () => {
    const onSelect = mock(() => {});
    const { stdin, unmount } = render(React.createElement(WelcomeScreen, { onSelect }));

    // Press Enter on first item (Local Mode)
    stdin.write('\r');
    await tick();
    expect(onSelect).toHaveBeenCalledWith('local');
    unmount();
  });

  it('Enter calls onSelect with "host" for second item', async () => {
    const onSelect = mock(() => {});
    const { stdin, unmount } = render(React.createElement(WelcomeScreen, { onSelect }));

    // Navigate to Host Mode
    stdin.write('\x1b[B');
    await tick();
    stdin.write('\r');
    await tick();
    expect(onSelect).toHaveBeenCalledWith('host');
    unmount();
  });

  it('Enter calls onSelect with "join" for third item', async () => {
    const onSelect = mock(() => {});
    const { stdin, unmount } = render(React.createElement(WelcomeScreen, { onSelect }));

    // Navigate to Join Mode
    stdin.write('\x1b[B');
    await tick();
    stdin.write('\x1b[B');
    await tick();
    stdin.write('\r');
    await tick();
    expect(onSelect).toHaveBeenCalledWith('join');
    unmount();
  });
});
