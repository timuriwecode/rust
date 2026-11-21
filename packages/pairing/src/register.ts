import AndroidFCM from '@liamcottle/push-receiver/src/android/fcm.js';
import { COMPANION_HOST } from '@rcomp/core';
import type { FcmCredentials } from './store.ts';

/**
 * Registers this machine as a "phone" for Rust+ push notifications, the same
 * way @liamcottle/rustplus.js `fcm-register` does:
 *
 *   1. create Firebase/GCM credentials for the Rust+ Android app id;
 *   2. exchange the FCM token for an Expo push token;
 *   3. register that push token with the Rust Companion API, using the
 *      Rust+ auth token (Steam sign-in).
 *
 * After that, pairing in game ("Pair with Server", "Pair" on a smart device)
 * sends a notification that `PairingListener` receives.
 */

// Public identifiers of the Rust+ Android app, as used by rustplus.js.
export const RUSTPLUS_APP = {
  apiKey: 'AIzaSyB5y2y-Tzqb4-I4Qnlsh_9naYv_TD8pCvY',
  projectId: 'rust-companion-app',
  gcmSenderId: '976529667804',
  gmsAppId: '1:976529667804:android:d6f1ddeb4403b338fea619',
  androidPackageName: 'com.facepunch.rust.companion',
  androidPackageCert: 'E28D05345FB78A7A1A63D70F4A302DBF426CA5AD',
  expoProjectId: '49451aca-a822-41e6-ad59-955718d0ff9c',
} as const;

export async function createFcmCredentials(): Promise<FcmCredentials> {
  const a = RUSTPLUS_APP;
  const credentials = await AndroidFCM.register(
    a.apiKey,
    a.projectId,
    a.gcmSenderId,
    a.gmsAppId,
    a.androidPackageName,
    a.androidPackageCert,
  );
  return {
    androidId: String(credentials.gcm.androidId),
    securityToken: String(credentials.gcm.securityToken),
    fcmToken: credentials.fcm.token,
  };
}

async function postJson(url: string, body: unknown): Promise<unknown> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`POST ${url} failed: HTTP ${response.status} ${text.slice(0, 300)}`);
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
}

export async function getExpoPushToken(fcmToken: string, deviceId: string): Promise<string> {
  const data = (await postJson('https://exp.host/--/api/v2/push/getExpoPushToken', {
    type: 'fcm',
    deviceId,
    development: false,
    appId: RUSTPLUS_APP.androidPackageName,
    deviceToken: fcmToken,
    projectId: RUSTPLUS_APP.expoProjectId,
  })) as { data?: { expoPushToken?: string } };
  const token = data?.data?.expoPushToken;
  if (!token) throw new Error('Expo did not return a push token');
  return token;
}

export async function registerWithCompanion(authToken: string, expoPushToken: string, deviceName = 'rust-companion'): Promise<unknown> {
  return postJson(`https://${COMPANION_HOST}/api/push/register`, {
    AuthToken: authToken,
    DeviceId: deviceName,
    PushKind: 3,
    PushToken: expoPushToken,
  });
}
