import { encodeCC } from '@domain/network-protocol';
import type { MidiOutputPort } from '@ports/midi-output.port';
import type { TcpServer } from './tcp-server';

export class TcpBroadcastOutputAdapter implements MidiOutputPort {
  private server: TcpServer;

  constructor(server: TcpServer) {
    this.server = server;
  }

  openVirtual(_name: string): void {
    // Server is already started by the bootstrap. No-op here.
    // The "name" is used for mDNS, not for TCP.
  }

  send(message: readonly [number, number, number]): void {
    const [status, cc, value] = message;
    const channel = status & 0x0f; // Extract channel from status byte
    this.server.broadcast(encodeCC(channel, cc, value));
  }

  close(): void {
    this.server.stop();
  }
}
