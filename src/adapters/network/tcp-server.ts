import { EventEmitter } from 'node:events';
import type { Socket, TCPSocketListener } from 'bun';
import { decodePinChallenge, encodePinResponse, decodeMessage, encodeHeartbeat, extractFrames, type NetworkMessage } from '../../domain/network-protocol';

type ClientState = {
  socket: Socket<{ id: string }>;
  authenticated: boolean;
  buffer: Uint8Array;
};

export class TcpServer extends EventEmitter {
  private server: TCPSocketListener<{ id: string }> | null = null;
  private clients = new Map<string, ClientState>();
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private pin: string | null;
  private nextClientId = 0;

  constructor(pin?: string) {
    super();
    this.pin = pin ?? null;
  }

  /** Builds socket handler callbacks — exposed for testability */
  buildSocketHandlers() {
    const self = this;
    return {
      open(socket: Socket<{ id: string }>) {
        const id = `client-${self.nextClientId++}`;
        socket.data = { id };
        self.clients.set(id, {
          socket,
          authenticated: self.pin === null,
          buffer: new Uint8Array(0),
        });
        if (self.pin === null) {
          self.emit('clientConnected', id, socket.remoteAddress);
        }
      },
      data(socket: Socket<{ id: string }>, data: Buffer) {
        const client = self.clients.get(socket.data.id);
        if (!client) return;

        const bytes = new Uint8Array(data as unknown as ArrayBuffer);

        if (!client.authenticated) {
          if (bytes.length >= 4) {
            const pin = decodePinChallenge(bytes);
            if (pin === self.pin) {
              client.authenticated = true;
              socket.write(encodePinResponse(true));
              self.emit('clientConnected', socket.data.id, socket.remoteAddress);
              if (bytes.length > 4) {
                const remaining = bytes.slice(4);
                self.processFrames(client, remaining);
              }
            } else {
              socket.write(encodePinResponse(false));
              socket.end();
              self.clients.delete(socket.data.id);
            }
          }
          return;
        }

        self.processFrames(client, bytes);
      },
      close(socket: Socket<{ id: string }>) {
        const id = socket.data.id;
        const client = self.clients.get(id);
        if (client?.authenticated) {
          self.emit('clientDisconnected', id);
        }
        self.clients.delete(id);
      },
      error(_socket: Socket<{ id: string }>, error: Error) {
        self.emit('error', error);
      },
    };
  }

  start(port: number, heartbeatMs = 5000): void {
    const handlers = this.buildSocketHandlers();
    this.server = Bun.listen<{ id: string }>({
      hostname: '0.0.0.0',
      port,
      socket: handlers,
    });

    // Heartbeat
    this.heartbeatInterval = setInterval(() => {
      this.broadcast(encodeHeartbeat());
    }, heartbeatMs);
  }

  private processFrames(client: ClientState, data: Uint8Array): void {
    const combined = new Uint8Array(client.buffer.length + data.length);
    combined.set(client.buffer);
    combined.set(data, client.buffer.length);

    const { frames, remaining } = extractFrames(combined);
    client.buffer = remaining;

    for (const frame of frames) {
      const msg = decodeMessage(frame);
      if (msg) {
        this.emit('message', msg, client.socket.data.id);
      }
    }
  }

  broadcast(data: Uint8Array): void {
    for (const [, client] of this.clients) {
      if (client.authenticated) {
        client.socket.write(data);
      }
    }
  }

  getClientCount(): number {
    return [...this.clients.values()].filter(c => c.authenticated).length;
  }

  getClients(): Array<{ id: string; address: string }> {
    return [...this.clients.entries()]
      .filter(([, c]) => c.authenticated)
      .map(([id, c]) => ({ id, address: c.socket.remoteAddress }));
  }

  stop(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    for (const [, client] of this.clients) {
      try { client.socket.end(); } catch {}
    }
    this.clients.clear();
    this.server?.stop();
    this.server = null;
  }
}
