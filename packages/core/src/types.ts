/**
 * Domain types produced by the Rust+ client.
 *
 * All 64-bit ids (SteamIDs, entity ids, marker ids) are decimal strings:
 * JavaScript numbers cannot hold them exactly.
 */

export type SteamId = string;

/** Map marker kinds sent by the server. Values match AppMarkerType in rustplus.proto. */
export const MarkerType = {
  Undefined: 0,
  Player: 1,
  Explosion: 2,
  VendingMachine: 3,
  CH47: 4,
  CargoShip: 5,
  Crate: 6,
  GenericRadius: 7,
  PatrolHelicopter: 8,
  TravellingVendor: 9,
} as const;
export type MarkerTypeId = (typeof MarkerType)[keyof typeof MarkerType];

/** Smart device kinds. Values match AppEntityType in rustplus.proto. */
export const EntityType = {
  Switch: 1,
  Alarm: 2,
  StorageMonitor: 3,
} as const;
export type EntityTypeId = (typeof EntityType)[keyof typeof EntityType];

export function markerTypeName(type: number): string {
  for (const [name, value] of Object.entries(MarkerType)) {
    if (value === type) return name;
  }
  return `Unknown(${type})`;
}

export function entityTypeName(type: number): string {
  for (const [name, value] of Object.entries(EntityType)) {
    if (value === type) return name;
  }
  return `Unknown(${type})`;
}

export interface ServerInfo {
  name: string;
  headerImage: string;
  url: string;
  map: string;
  mapSize: number;
  /** Unix seconds of the last wipe. */
  wipeTime: number;
  players: number;
  maxPlayers: number;
  queuedPlayers: number;
  seed?: number;
  salt?: number;
  logoImage?: string;
  nexus?: string;
  nexusId?: number;
  nexusZone?: string;
}

export interface GameTime {
  dayLengthMinutes: number;
  timeScale: number;
  /** Hours, 0..24 (float). */
  sunrise: number;
  /** Hours, 0..24 (float). */
  sunset: number;
  /** Current in-game time in hours, 0..24 (float). */
  time: number;
}

export interface Monument {
  token: string;
  x: number;
  y: number;
}

export interface MapData {
  width: number;
  height: number;
  jpgImage: Uint8Array;
  oceanMargin: number;
  monuments: Monument[];
  background?: string;
}

export interface TeamMember {
  steamId: SteamId;
  name: string;
  x: number;
  y: number;
  isOnline: boolean;
  /** Unix seconds. */
  spawnTime: number;
  isAlive: boolean;
  /** Unix seconds. */
  deathTime: number;
}

export interface TeamNote {
  type: number;
  x: number;
  y: number;
}

export interface TeamInfo {
  leaderSteamId: SteamId;
  members: TeamMember[];
  mapNotes: TeamNote[];
  leaderMapNotes: TeamNote[];
}

export interface TeamMessage {
  steamId: SteamId;
  name: string;
  message: string;
  color: string;
  /** Unix seconds. */
  time: number;
}

export interface SellOrder {
  itemId: number;
  quantity: number;
  currencyId: number;
  costPerItem: number;
  amountInStock: number;
  itemIsBlueprint: boolean;
  currencyIsBlueprint: boolean;
  itemCondition?: number;
  itemConditionMax?: number;
}

export interface Vector4 {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface MapMarker {
  id: string;
  type: number;
  x: number;
  y: number;
  steamId?: SteamId;
  rotation?: number;
  radius?: number;
  color1?: Vector4;
  color2?: Vector4;
  alpha?: number;
  name?: string;
  outOfStock?: boolean;
  sellOrders: SellOrder[];
}

export interface EntityItem {
  itemId: number;
  quantity: number;
  itemIsBlueprint: boolean;
}

export interface EntityPayload {
  /** Switch on/off, alarm active, storage monitor "has items". */
  value?: boolean;
  items: EntityItem[];
  capacity?: number;
  /** Storage monitor on a tool cupboard: whether upkeep is paid. */
  hasProtection?: boolean;
  /** Storage monitor on a tool cupboard: unix seconds when protection runs out. */
  protectionExpiry?: number;
}

export interface EntityInfo {
  type: number;
  payload: EntityPayload;
}

export interface ClanMessage {
  steamId: SteamId;
  name: string;
  message: string;
  time: number;
}

/** Broadcasts pushed by the server without a request. */
export interface TeamChangedBroadcast {
  playerId: SteamId;
  teamInfo: TeamInfo;
}

export interface EntityChangedBroadcast {
  entityId: string;
  payload: EntityPayload;
}

export interface ClanMessageBroadcast {
  clanId: string;
  message: ClanMessage;
}
