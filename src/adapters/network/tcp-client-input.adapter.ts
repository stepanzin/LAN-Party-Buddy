import type { NetworkMessage } from '@domain/network-protocol';
import type { MidiErrorHandler, MidiInputPort, MidiMessageHandler } from '@ports/midi-input.port';
import type { MdnsBrowserDiscoveryAdapter } from './mdns-browser-discovery.adapter';
import type { TcpClient } from './tcp-client';

export class TcpClientInputAdapter implements MidiInputPort {
  private client: TcpClient;
  private browser: MdnsBrowserDiscoveryAdapter;

  constructor(client: TcpClient, browser: MdnsBrowserDiscoveryAdapter) {
    this.client = client;
    this.browser = browser;
  }

  onMessage(handler: MidiMessageHandler): void {
    this.client.on('message', (msg: NetworkMessage) => {
      if (msg.type === 'cc') {
        handler({ channel: msg.channel, cc: msg.cc, value: msg.value });
      }
    });
  }

  onError(handler: MidiErrorHandler): void {
    this.client.on('error', (err: Error) => handler(err));
  }

  open(deviceIndex: number): void {
    const service = this.browser.getServiceByIndex(deviceIndex);
    if (!service) throw new Error(`No service found at index ${deviceIndex}`);
    // Connect without PIN initially — PIN handled by bootstrap before this
    this.client.connect(service.host, service.port);
  }

  close(): void {
    this.client.disconnect();
  }
}
