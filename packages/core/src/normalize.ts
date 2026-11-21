import type { Raw } from './protocol.ts';
import type {
  ClanMessage,
  EntityInfo,
  EntityPayload,
  GameTime,
  MapData,
  MapMarker,
  SellOrder,
  ServerInfo,
  TeamInfo,
  TeamMember,
  TeamMessage,
  TeamNote,
  Vector4,
} from './types.ts';

/**
 * Converts decoded protobuf objects into domain types with defaults filled in.
 * Every field in our schema is optional, so nothing here may assume presence.
 */

const num = (v: unknown, d = 0): number => (typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : d);
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : v == null ? d : String(v));
const bool = (v: unknown, d = false): boolean => (typeof v === 'boolean' ? v : d);
const optNum = (v: unknown): number | undefined => (v == null ? undefined : num(v));
const optStr = (v: unknown): string | undefined => (v == null ? undefined : str(v));
const optBool = (v: unknown): boolean | undefined => (v == null ? undefined : bool(v));
const list = (v: unknown): Raw[] => (Array.isArray(v) ? (v as Raw[]) : []);

export function toServerInfo(r: Raw = {}): ServerInfo {
  return {
    name: str(r.name),
    headerImage: str(r.headerImage),
    url: str(r.url),
    map: str(r.map),
    mapSize: num(r.mapSize),
    wipeTime: num(r.wipeTime),
    players: num(r.players),
    maxPlayers: num(r.maxPlayers),
    queuedPlayers: num(r.queuedPlayers),
    seed: optNum(r.seed),
    salt: optNum(r.salt),
    logoImage: optStr(r.logoImage),
    nexus: optStr(r.nexus),
    nexusId: optNum(r.nexusId),
    nexusZone: optStr(r.nexusZone),
  };
}

export function toGameTime(r: Raw = {}): GameTime {
  return {
    dayLengthMinutes: num(r.dayLengthMinutes),
    timeScale: num(r.timeScale),
    sunrise: num(r.sunrise),
    sunset: num(r.sunset),
    time: num(r.time),
  };
}

export function toMapData(r: Raw = {}): MapData {
  return {
    width: num(r.width),
    height: num(r.height),
    jpgImage: r.jpgImage instanceof Uint8Array ? r.jpgImage : new Uint8Array(),
    oceanMargin: num(r.oceanMargin),
    monuments: list(r.monuments).map((m) => ({ token: str(m.token), x: num(m.x), y: num(m.y) })),
    background: optStr(r.background),
  };
}

function toTeamMember(r: Raw): TeamMember {
  return {
    steamId: str(r.steamId, '0'),
    name: str(r.name),
    x: num(r.x),
    y: num(r.y),
    isOnline: bool(r.isOnline),
    spawnTime: num(r.spawnTime),
    isAlive: bool(r.isAlive),
    deathTime: num(r.deathTime),
  };
}

function toTeamNote(r: Raw): TeamNote {
  return { type: num(r.type), x: num(r.x), y: num(r.y) };
}

export function toTeamInfo(r: Raw = {}): TeamInfo {
  return {
    leaderSteamId: str(r.leaderSteamId, '0'),
    members: list(r.members).map(toTeamMember),
    mapNotes: list(r.mapNotes).map(toTeamNote),
    leaderMapNotes: list(r.leaderMapNotes).map(toTeamNote),
  };
}

export function toTeamMessage(r: Raw = {}): TeamMessage {
  return {
    steamId: str(r.steamId, '0'),
    name: str(r.name),
    message: str(r.message),
    color: str(r.color),
    time: num(r.time),
  };
}

export function toTeamChat(r: Raw = {}): TeamMessage[] {
  return list(r.messages).map(toTeamMessage);
}

function toVector4(r: unknown): Vector4 | undefined {
  if (r == null || typeof r !== 'object') return undefined;
  const v = r as Raw;
  return { x: num(v.x), y: num(v.y), z: num(v.z), w: num(v.w) };
}

function toSellOrder(r: Raw): SellOrder {
  return {
    itemId: num(r.itemId),
    quantity: num(r.quantity),
    currencyId: num(r.currencyId),
    costPerItem: num(r.costPerItem),
    amountInStock: num(r.amountInStock),
    itemIsBlueprint: bool(r.itemIsBlueprint),
    currencyIsBlueprint: bool(r.currencyIsBlueprint),
    itemCondition: optNum(r.itemCondition),
    itemConditionMax: optNum(r.itemConditionMax),
  };
}

export function toMapMarker(r: Raw): MapMarker {
  return {
    id: str(r.id, '0'),
    type: num(r.type),
    x: num(r.x),
    y: num(r.y),
    steamId: optStr(r.steamId),
    rotation: optNum(r.rotation),
    radius: optNum(r.radius),
    color1: toVector4(r.color1),
    color2: toVector4(r.color2),
    alpha: optNum(r.alpha),
    name: optStr(r.name),
    outOfStock: optBool(r.outOfStock),
    sellOrders: list(r.sellOrders).map(toSellOrder),
  };
}

export function toMapMarkers(r: Raw = {}): MapMarker[] {
  return list(r.markers).map(toMapMarker);
}

export function toEntityPayload(r: Raw = {}): EntityPayload {
  return {
    value: optBool(r.value),
    items: list(r.items).map((i) => ({
      itemId: num(i.itemId),
      quantity: num(i.quantity),
      itemIsBlueprint: bool(i.itemIsBlueprint),
    })),
    capacity: optNum(r.capacity),
    hasProtection: optBool(r.hasProtection),
    protectionExpiry: optNum(r.protectionExpiry),
  };
}

export function toEntityInfo(r: Raw = {}): EntityInfo {
  return { type: num(r.type), payload: toEntityPayload(r.payload) };
}

export function toClanMessage(r: Raw = {}): ClanMessage {
  return {
    steamId: str(r.steamId, '0'),
    name: str(r.name),
    message: str(r.message),
    time: num(r.time),
  };
}
