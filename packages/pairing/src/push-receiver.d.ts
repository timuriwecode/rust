// Minimal typings for the parts of @liamcottle/push-receiver we use.

declare module '@liamcottle/push-receiver/src/client.js' {
  import { EventEmitter } from 'node:events';

  export interface DataMessage {
    persistentId?: string;
    from?: string;
    category?: string;
    appData?: Array<{ key: string; value: string }>;
    [key: string]: unknown;
  }

  export default class PushReceiverClient extends EventEmitter {
    constructor(androidId: string, securityToken: string, persistentIds?: string[]);
    connect(): Promise<void>;
    destroy(): void;
  }
}

declare module '@liamcottle/push-receiver/src/android/fcm.js' {
  export interface AndroidFcmCredentials {
    gcm: { androidId: string; securityToken: string };
    fcm: { token: string };
  }

  const AndroidFCM: {
    register(
      apiKey: string,
      projectId: string,
      gcmSenderId: string,
      gmsAppId: string,
      androidPackageName: string,
      androidPackageCert: string,
    ): Promise<AndroidFcmCredentials>;
  };
  export default AndroidFCM;
}
