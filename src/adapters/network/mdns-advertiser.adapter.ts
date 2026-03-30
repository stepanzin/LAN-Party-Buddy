import { Bonjour } from 'bonjour-service';

export class MdnsAdvertiserAdapter {
  private bonjour: Bonjour;

  constructor(bonjour?: Bonjour) {
    this.bonjour = bonjour ?? new Bonjour();
  }
  private service: ReturnType<Bonjour['publish']> | null = null;

  advertise(port: number, name: string, pinRequired: boolean): void {
    this.stopAdvertising();
    this.service = this.bonjour.publish({
      name,
      type: 'midi-mapper',
      port,
      txt: {
        pin: pinRequired ? 'required' : 'open',
        version: '1',
      },
    });
  }

  stopAdvertising(): void {
    if (this.service) {
      this.service.stop?.();
      this.service = null;
    }
  }

  destroy(): void {
    this.stopAdvertising();
    this.bonjour.destroy();
  }
}
