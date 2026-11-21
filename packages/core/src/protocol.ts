import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import protobuf from 'protobufjs';

/**
 * Low-level protobuf encoding/decoding for the Rust+ protocol.
 *
 * Decoded messages are plain objects: 64-bit integers become decimal strings,
 * enums stay numbers, bytes stay Uint8Array, unset fields are absent.
 */

const PROTO_PATH = fileURLToPath(new URL('./proto/rustplus.proto', import.meta.url));

let root: protobuf.Root | undefined;

function getRoot(): protobuf.Root {
  if (!root) {
    root = protobuf.parse(readFileSync(PROTO_PATH, 'utf8'), { keepCase: true }).root;
  }
  return root;
}

function type(name: string): protobuf.Type {
  return getRoot().lookupType(`rustplus.${name}`);
}

const TO_OBJECT: protobuf.IConversionOptions = {
  longs: String,
  enums: Number,
  arrays: true,
  defaults: false,
};

/** A decoded protobuf message: plain nested object. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Raw = Record<string, any>;

export interface RawAppMessage {
  response?: Raw & { seq?: number; error?: { error?: string } };
  broadcast?: Raw;
}

/** Fields of AppRequest other than the auth fields the client fills in. */
export type RequestBody = Raw;

export interface RequestEnvelope {
  seq: number;
  playerId: string;
  playerToken: number;
  entityId?: string | number;
}

export function encodeRequest(envelope: RequestEnvelope, body: RequestBody): Uint8Array {
  const AppRequest = type('AppRequest');
  const message = AppRequest.fromObject({ ...body, ...envelope });
  return AppRequest.encode(message).finish();
}

export function decodeRequest(bytes: Uint8Array): Raw {
  const AppRequest = type('AppRequest');
  return AppRequest.toObject(AppRequest.decode(bytes), TO_OBJECT);
}

export function encodeMessage(message: RawAppMessage): Uint8Array {
  const AppMessage = type('AppMessage');
  return AppMessage.encode(AppMessage.fromObject(message)).finish();
}

export function decodeMessage(bytes: Uint8Array): RawAppMessage {
  const AppMessage = type('AppMessage');
  return AppMessage.toObject(AppMessage.decode(bytes), TO_OBJECT) as RawAppMessage;
}
