import { describe, expect, it } from 'vitest';
import { parsePushMessage } from '../src/notification.ts';

function push(channelId: string, body: Record<string, unknown>, title = 'T', message = 'M') {
  return {
    persistentId: 'p1',
    appData: [
      { key: 'title', value: title },
      { key: 'message', value: message },
      { key: 'channelId', value: channelId },
      { key: 'body', value: JSON.stringify(body) },
    ],
  };
}

const serverBody = {
  id: 'b3c1a7f0-0000-4000-8000-000000000001',
  ip: '203.0.113.10',
  port: '28082',
  name: 'Test Server',
  desc: 'line1\\nline2',
  img: '',
  url: 'https://example.invalid',
  type: 'server',
  playerId: '76561198000000123',
  playerToken: '-987654',
};

describe('parsePushMessage', () => {
  it('parses a server pairing (pre-relay format with ip/port)', () => {
    const event = parsePushMessage(push('pairing', serverBody));
    expect(event).toMatchObject({
      kind: 'serverPaired',
      server: {
        key: serverBody.id,
        relayId: serverBody.id,
        ip: '203.0.113.10',
        port: 28082,
        name: 'Test Server',
        description: 'line1\nline2',
        playerId: '76561198000000123',
        playerToken: -987654,
      },
    });
  });

  it('parses a relay-era server pairing without ip/port', () => {
    const { ip: _ip, port: _port, ...relayOnly } = serverBody;
    const event = parsePushMessage(push('pairing', relayOnly));
    expect(event.kind).toBe('serverPaired');
    if (event.kind !== 'serverPaired') return;
    expect(event.server.key).toBe(serverBody.id);
    expect(event.server.ip).toBeUndefined();
    expect(event.server.port).toBeUndefined();
  });

  it('falls back to ip:port as the key when there is no id', () => {
    const { id: _id, ...legacy } = serverBody;
    const event = parsePushMessage(push('pairing', legacy));
    expect(event.kind === 'serverPaired' && event.server.key).toBe('203.0.113.10:28082');
  });

  it('parses an entity pairing', () => {
    const event = parsePushMessage(
      push('pairing', { ...serverBody, type: 'entity', entityId: '123456', entityType: '2', entityName: 'Smart Alarm' }),
    );
    expect(event).toMatchObject({
      kind: 'entityPaired',
      server: { key: serverBody.id },
      entity: { entityId: '123456', entityType: 2, entityName: 'Smart Alarm' },
    });
  });

  it('parses a smart alarm', () => {
    const event = parsePushMessage(push('alarm', serverBody, 'Base', 'Your base is under attack!'));
    expect(event).toMatchObject({ kind: 'alarm', serverKey: serverBody.id, title: 'Base', message: 'Your base is under attack!' });
  });

  it('keeps anything else as "other"', () => {
    expect(parsePushMessage(push('player', { type: 'death' })).kind).toBe('other');
    expect(parsePushMessage({ appData: [{ key: 'body', value: '{broken' }] })).toMatchObject({ kind: 'other', body: null });
    expect(parsePushMessage(push('pairing', { type: 'server' })).kind).toBe('other');
  });
});
