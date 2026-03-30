import { describe, expect, it, mock } from 'bun:test';
import { PinEntry } from '@adapters/ink-tui/components/pin-entry';
import { render } from 'ink-testing-library';
import React from 'react';

const tick = () => new Promise((r) => setTimeout(r, 30));

describe('PinEntry', () => {
  it('renders host name', () => {
    const onSubmit = mock(() => {});
    const onCancel = mock(() => {});
    const { lastFrame, unmount } = render(React.createElement(PinEntry, { hostName: 'Studio PC', onSubmit, onCancel }));
    expect(lastFrame()).toContain('Connect to: Studio PC');
    unmount();
  });

  it('shows empty placeholders initially', () => {
    const onSubmit = mock(() => {});
    const onCancel = mock(() => {});
    const { lastFrame, unmount } = render(React.createElement(PinEntry, { hostName: 'Host', onSubmit, onCancel }));
    expect(lastFrame()).toContain('_ _ _ _');
    unmount();
  });

  it('accepts digit input (0-9 only)', async () => {
    const onSubmit = mock(() => {});
    const onCancel = mock(() => {});
    const { lastFrame, stdin, unmount } = render(
      React.createElement(PinEntry, { hostName: 'Host', onSubmit, onCancel }),
    );

    stdin.write('1');
    await tick();
    expect(lastFrame()).toContain('1 _ _ _');

    stdin.write('2');
    await tick();
    expect(lastFrame()).toContain('1 2 _ _');

    // Non-digit should be ignored
    stdin.write('a');
    await tick();
    expect(lastFrame()).toContain('1 2 _ _');

    unmount();
  });

  it('shows digits with placeholders (e.g., "1 2 _ _")', async () => {
    const onSubmit = mock(() => {});
    const onCancel = mock(() => {});
    const { lastFrame, stdin, unmount } = render(
      React.createElement(PinEntry, { hostName: 'Host', onSubmit, onCancel }),
    );

    stdin.write('1');
    await tick();
    stdin.write('2');
    await tick();
    expect(lastFrame()).toContain('1 2 _ _');
    unmount();
  });

  it('Enter submits when 4 digits entered', async () => {
    const onSubmit = mock(() => {});
    const onCancel = mock(() => {});
    const { stdin, unmount } = render(React.createElement(PinEntry, { hostName: 'Host', onSubmit, onCancel }));

    stdin.write('1');
    await tick();
    stdin.write('2');
    await tick();
    stdin.write('3');
    await tick();
    stdin.write('4');
    await tick();
    stdin.write('\r');
    await tick();

    expect(onSubmit).toHaveBeenCalledWith('1234');
    unmount();
  });

  it('Enter does NOT submit with < 4 digits', async () => {
    const onSubmit = mock(() => {});
    const onCancel = mock(() => {});
    const { stdin, unmount } = render(React.createElement(PinEntry, { hostName: 'Host', onSubmit, onCancel }));

    stdin.write('1');
    await tick();
    stdin.write('2');
    await tick();
    stdin.write('\r');
    await tick();

    expect(onSubmit).not.toHaveBeenCalled();
    unmount();
  });

  it('Backspace removes last digit', async () => {
    const onSubmit = mock(() => {});
    const onCancel = mock(() => {});
    const { lastFrame, stdin, unmount } = render(
      React.createElement(PinEntry, { hostName: 'Host', onSubmit, onCancel }),
    );

    stdin.write('1');
    await tick();
    stdin.write('2');
    await tick();
    stdin.write('3');
    await tick();
    expect(lastFrame()).toContain('1 2 3 _');

    stdin.write('\x7f'); // backspace
    await tick();
    expect(lastFrame()).toContain('1 2 _ _');

    unmount();
  });

  it('Esc calls onCancel', async () => {
    const onSubmit = mock(() => {});
    const onCancel = mock(() => {});
    const { stdin, unmount } = render(React.createElement(PinEntry, { hostName: 'Host', onSubmit, onCancel }));

    stdin.write('\x1b');
    await tick();
    expect(onCancel).toHaveBeenCalled();
    unmount();
  });

  it('does not accept more than 4 digits', async () => {
    const onSubmit = mock(() => {});
    const onCancel = mock(() => {});
    const { lastFrame, stdin, unmount } = render(
      React.createElement(PinEntry, { hostName: 'Host', onSubmit, onCancel }),
    );

    stdin.write('1');
    await tick();
    stdin.write('2');
    await tick();
    stdin.write('3');
    await tick();
    stdin.write('4');
    await tick();
    stdin.write('5');
    await tick();
    expect(lastFrame()).toContain('1 2 3 4');
    expect(lastFrame()).not.toContain('5');

    unmount();
  });
});
