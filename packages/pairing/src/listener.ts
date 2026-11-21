import { EventEmitter } from 'node:events';
import PushReceiverClient, { type DataMessage } from '@liamcottle/push-receiver/src/client.js';
import { parsePushMessage, type PushEvent } from './notification.ts';

export interface PairingListenerEvents {
  push: [event: PushEvent, persistentId: string | undefined];
  connected: [];
  disconnected: [];
}

/** Listens for Rust+ push notifications (pairing, smart alarms) over FCM. */
export class PairingListener extends EventEmitter<PairingListenerEvents> {
  private client: PushReceiverClient | null = null;

  constructor(
    private readonly credentials: { androidId: string; securityToken: string },
    private readonly persistentIds: string[] = [],
  ) {
    super();
  }

  async start(): Promise<void> {
    const client = new PushReceiverClient(this.credentials.androidId, this.credentials.securityToken, [...this.persistentIds]);
    this.client = client;
    client.on('connect', () => this.emit('connected'));
    client.on('disconnect', () => this.emit('disconnected'));
    client.on('ON_DATA_RECEIVED', (data: DataMessage) => {
      this.emit('push', parsePushMessage(data), data.persistentId);
    });
    await client.connect();
  }

  stop(): void {
    this.client?.destroy();
    this.client = null;
  }
}
