import { EventEmitter } from 'node:events';
import { decodeMessage, decodePinResponse, encodePinChallenge, extractFrames } from '@domain/network-protocol';
import type { Socket } from 'bun';

export class TcpClient extends EventEmitter {
  private socket: Socket<Record<string, never>> | null = null;
  private buffer = new Uint8Array(0);
  private pin: string | null = null;
  private authenticated = false;
  private _connected = false;

  get isConnected(): boolean {
    return this._connected && this.authenticated;
  }

  /** Builds socket handler callbacks — exposed for testability */
  buildSocketHandlers(resolveConnect: (value: boolean) => void) {
    const self = this;
    return {
      open(socket: Socket<Record<string, never>>) {
        self.socket = socket;
        self._connected = true;

        if (self.pin) {
          socket.write(encodePinChallenge(self.pin));
        } else {
          self.authenticated = true;
          self.emit('connected');
          resolveConnect(true);
        }
      },
      data(_socket: Socket<Record<string, never>>, data: Buffer) {
        const bytes = new Uint8Array(data as unknown as ArrayBuffer);

        if (self.pin && !self.authenticated) {
          if (bytes.length >= 1) {
            const accepted = decodePinResponse(bytes);
            if (accepted) {
              self.authenticated = true;
              self.emit('connected');
              resolveConnect(true);
              if (bytes.length > 1) {
                self.processFrames(bytes.slice(1));
              }
            } else {
              self.emit('authFailed');
              resolveConnect(false);
              _socket.end();
            }
          }
          return;
        }

        self.processFrames(bytes);
      },
      close() {
        self._connected = false;
        self.authenticated = false;
        self.emit('disconnected');
      },
      error(_socket: Socket<Record<string, never>>, error: Error) {
        self.emit('error', error);
        resolveConnect(false);
      },
    };
  }

  async connect(host: string, port: number, pin?: string): Promise<boolean> {
    this.pin = pin ?? null;
    this.authenticated = this.pin === null;
    this.buffer = new Uint8Array(0);

    let resolveConnect: (value: boolean) => void = () => {};
    const resultPromise = new Promise<boolean>((resolve) => {
      resolveConnect = resolve;
    });

    try {
      const handlers = this.buildSocketHandlers(resolveConnect);
      await Bun.connect<Record<string, never>>({
        hostname: host,
        port,
        socket: handlers,
        data: {},
      });
    } catch {
      this.emit('error', new Error('Connection failed'));
      return false;
    }

    return resultPromise;
  }

  private processFrames(data: Uint8Array): void {
    const combined = new Uint8Array(this.buffer.length + data.length);
    combined.set(this.buffer);
    combined.set(data, this.buffer.length);

    const { frames, remaining } = extractFrames(combined);
    this.buffer = remaining;

    for (const frame of frames) {
      const msg = decodeMessage(frame);
      if (msg) {
        if (msg.type === 'disconnect') {
          this.disconnect();
          return;
        }
        this.emit('message', msg);
      }
    }
  }

  send(data: Uint8Array): void {
    if (this.socket && this._connected) {
      this.socket.write(data);
    }
  }

  disconnect(): void {
    try {
      this.socket?.end();
    } catch {}
    this.socket = null;
    this._connected = false;
    this.authenticated = false;
  }
}
