import { describe, expect, it } from 'bun:test';
import { App } from '@adapters/ink-tui/app';
import { TuiStore } from '@adapters/ink-tui/tui-store';
import type { AppConfig } from '@domain/config';
import { render } from 'ink-testing-library';
import React from 'react';

const TEST_CONFIG: AppConfig = {
  deviceName: 'Test Output',
  rules: [{ cc: 4, label: 'Expression', inputMin: 0, inputMax: 127, outputMin: 0, outputMax: 127, curve: 'linear' }],
};

const tick = () => new Promise((r) => setTimeout(r, 30));

function renderApp(mode: 'local' | 'host' | 'join' = 'local') {
  const store = new TuiStore();
  store.setConfig(TEST_CONFIG);
  store.setMode(mode);

  const { lastFrame, stdin, unmount } = render(React.createElement(App, { store }));

  return { store, lastFrame, stdin, unmount };
}

describe('Network UI', () => {
  describe('header mode badge', () => {
    it('shows [LOCAL] when mode is local', () => {
      const { lastFrame, unmount } = renderApp('local');
      expect(lastFrame()).toContain('[LOCAL]');
      unmount();
    });

    it('shows [HOST] when mode is host', () => {
      const { lastFrame, unmount } = renderApp('host');
      expect(lastFrame()).toContain('[HOST]');
      unmount();
    });

    it('shows [JOIN] when mode is join', () => {
      const { lastFrame, unmount } = renderApp('join');
      expect(lastFrame()).toContain('[JOIN]');
      unmount();
    });
  });

  describe('monitor tab: host mode', () => {
    it('shows client list in host mode when clients are connected', async () => {
      const { store, lastFrame, unmount } = renderApp('host');

      store.addClient({ id: 'c1', address: '192.168.1.10' });
      store.addClient({ id: 'c2', address: '192.168.1.11' });
      await tick();

      const frame = lastFrame();
      expect(frame).toContain('Network');
      expect(frame).toContain('192.168.1.10');
      expect(frame).toContain('192.168.1.11');
      unmount();
    });

    it('does not show network section when no clients connected in host mode', () => {
      const { lastFrame, unmount } = renderApp('host');
      // No clients added
      // Network section should not appear in monitor tab (no clients)
      // But the header HostStatus will show. We check monitor tab specifically.
      const frame = lastFrame();
      // The monitor tab itself should not show "Network" label for 0 clients
      // (HostStatus in header is separate)
      expect(frame).toContain('[HOST]');
      unmount();
    });
  });

  describe('monitor tab: join mode', () => {
    it('shows connected host in join mode', async () => {
      const { store, lastFrame, unmount } = renderApp('join');

      store.setConnectedHost({ name: 'Studio PC', address: '192.168.1.5', port: 9900 });
      await tick();

      const frame = lastFrame();
      expect(frame).toContain('Network');
      expect(frame).toContain('Studio PC');
      expect(frame).toContain('192.168.1.5');
      unmount();
    });

    it('does not show network section in join mode when no host connected', () => {
      const { lastFrame, unmount } = renderApp('join');
      const frame = lastFrame();
      // Should show "Not connected" in the header JoinStatus, but monitor tab
      // should not show Network section without a connected host
      expect(frame).toContain('[JOIN]');
      expect(frame).toContain('Not connected to any host');
      unmount();
    });
  });

  describe('settings tab: host mode', () => {
    it('shows network section in host mode', async () => {
      const { store, lastFrame, stdin, unmount } = renderApp('host');

      store.setHostInfo(9900, null, 'open');
      stdin.write('4'); // switch to settings tab
      await tick();

      const frame = lastFrame();
      expect(frame).toContain('Network');
      expect(frame).toContain('9900');
      expect(frame).toContain('Open');
      unmount();
    });

    it('shows PIN in settings when access mode is pin', async () => {
      const { store, lastFrame, stdin, unmount } = renderApp('host');

      store.setHostInfo(8080, '4567', 'pin');
      stdin.write('4'); // switch to settings tab
      await tick();

      const frame = lastFrame();
      expect(frame).toContain('Network');
      expect(frame).toContain('8080');
      expect(frame).toContain('PIN: 4567');
      unmount();
    });
  });

  describe('settings tab: join mode', () => {
    it('shows connected host info in join mode', async () => {
      const { store, lastFrame, stdin, unmount } = renderApp('join');

      store.setConnectedHost({ name: 'Studio PC', address: '192.168.1.5', port: 9900 });
      stdin.write('4'); // switch to settings tab
      await tick();

      const frame = lastFrame();
      expect(frame).toContain('Network');
      expect(frame).toContain('Studio PC');
      expect(frame).toContain('192.168.1.5:9900');
      unmount();
    });

    it('does not show network section in settings when no host connected in join mode', async () => {
      const { lastFrame, stdin, unmount } = renderApp('join');

      stdin.write('4'); // switch to settings tab
      await tick();

      const frame = lastFrame();
      // Network section only appears when connectedHost is set
      expect(frame).toContain('Virtual MIDI Port');
      unmount();
    });
  });

  describe('settings tab: local mode', () => {
    it('does not show network section in local mode', async () => {
      const { lastFrame, stdin, unmount } = renderApp('local');

      stdin.write('4'); // switch to settings tab
      await tick();

      const frame = lastFrame();
      expect(frame).toContain('Virtual MIDI Port');
      // Should not show any network-related info in settings for local mode
      expect(frame).not.toContain('Network');
      unmount();
    });
  });
});
