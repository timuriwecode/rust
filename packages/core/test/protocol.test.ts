import { describe, expect, it } from 'vitest';
import { decodeMessage, decodeRequest, encodeMessage, encodeRequest } from '../src/protocol.ts';
import { toMapMarkers } from '../src/normalize.ts';

describe('protocol', () => {
  it('round-trips a request with 64-bit ids', () => {
    const bytes = encodeRequest(
      { seq: 7, playerId: '76561198000000123', playerToken: -12345, entityId: '5000000000' },
      { getEntityInfo: {} },
    );
    const decoded = decodeRequest(bytes);
    expect(decoded.seq).toBe(7);
    expect(decoded.playerId).toBe('76561198000000123');
    expect(decoded.playerToken).toBe(-12345);
    expect(decoded.entityId).toBe('5000000000');
    expect(decoded.getEntityInfo).toEqual({});
  });

  it('decodes messages with missing fields instead of throwing', () => {
    // AppInfo used to have only `required` fields; a partial one must still decode.
    const bytes = encodeMessage({ response: { seq: 1, info: { name: 'x' } } });
    const message = decodeMessage(bytes);
    expect(message.response?.info).toEqual({ name: 'x' });
  });

  it('keeps unknown marker types as numbers', () => {
    const bytes = encodeMessage({
      response: { seq: 2, mapMarkers: { markers: [{ id: 1, type: 9, x: 1, y: 2 }, { id: 2, type: 42, x: 3, y: 4 }] } },
    });
    const markers = toMapMarkers(decodeMessage(bytes).response?.mapMarkers);
    expect(markers.map((m) => m.type)).toEqual([9, 42]);
    expect(markers[0]?.id).toBe('1');
  });
});
