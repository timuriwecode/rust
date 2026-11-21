import {
  entityTypeName,
  formatGameTime,
  gridReference,
  isNight,
  markerTypeName,
  type EntityInfo,
  type GameTime,
  type MapMarker,
  type ServerInfo,
  type TeamInfo,
  type TeamMessage,
} from '@rcomp/core';

export function ago(unixSeconds: number, now = Date.now()): string {
  if (!unixSeconds) return '—';
  let s = Math.max(0, Math.round(now / 1000 - unixSeconds));
  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  if (d) return `${d} д ${h} ч назад`;
  if (h) return `${h} ч ${m} мин назад`;
  return `${m} мин назад`;
}

export function until(unixSeconds: number, now = Date.now()): string {
  const s = Math.round(unixSeconds - now / 1000);
  if (s <= 0) return 'истекло';
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d} д ${h} ч`;
  return h ? `${h} ч ${m} мин` : `${m} мин`;
}

export function formatInfo(info: ServerInfo): string {
  return [
    `Сервер:  ${info.name}`,
    `Карта:   ${info.map}, ${info.mapSize} м${info.seed != null ? `, seed ${info.seed}` : ''}`,
    `Онлайн:  ${info.players}/${info.maxPlayers}${info.queuedPlayers ? `, очередь ${info.queuedPlayers}` : ''}`,
    `Вайп:    ${ago(info.wipeTime)}`,
  ].join('\n');
}

export function formatTime(time: GameTime): string {
  const phase = isNight(time.time, time.sunrise, time.sunset) ? 'ночь' : 'день';
  return `Время:   ${formatGameTime(time.time)} (${phase}), рассвет ${formatGameTime(time.sunrise)}, закат ${formatGameTime(time.sunset)}`;
}

export function formatTeam(team: TeamInfo, mapSize: number): string {
  if (team.members.length === 0) return 'Команда: нет (игрок не в команде)';
  const lines = [`Команда (${team.members.length}):`];
  for (const m of team.members) {
    const status = !m.isOnline ? 'оффлайн' : m.isAlive ? 'жив' : `мёртв (${ago(m.deathTime)})`;
    const grid = gridReference(m.x, m.y, mapSize) ?? '?';
    const leader = m.steamId === team.leaderSteamId ? ' [лидер]' : '';
    lines.push(`  ${m.isOnline ? '●' : '○'} ${m.name}${leader} — ${grid}, ${status}`);
  }
  return lines.join('\n');
}

export function formatMarkers(markers: MapMarker[]): string {
  if (markers.length === 0) return 'Маркеры: нет';
  const counts = new Map<string, number>();
  for (const m of markers) counts.set(markerTypeName(m.type), (counts.get(markerTypeName(m.type)) ?? 0) + 1);
  return `Маркеры: ${[...counts].map(([name, n]) => `${name}×${n}`).join(', ')}`;
}

export function formatMarkerList(markers: MapMarker[], mapSize: number): string {
  return markers
    .map((m) => {
      const grid = gridReference(m.x, m.y, mapSize) ?? '?';
      const extra = [m.name, m.steamId, m.radius != null ? `r=${m.radius.toFixed(0)}` : undefined].filter(Boolean).join(' ');
      return `  #${m.id} ${markerTypeName(m.type).padEnd(16)} ${grid.padEnd(4)} (${m.x.toFixed(0)}, ${m.y.toFixed(0)}) ${extra}`;
    })
    .join('\n');
}

export function formatChat(messages: TeamMessage[]): string {
  if (messages.length === 0) return '(чат пуст)';
  return messages
    .map((m) => `  [${new Date(m.time * 1000).toLocaleTimeString()}] ${m.name}: ${m.message}`)
    .join('\n');
}

export function formatEntity(id: string, info: EntityInfo): string {
  const p = info.payload;
  const lines = [`Устройство ${id}: ${entityTypeName(info.type)}`];
  if (p.value != null) lines.push(`  значение: ${p.value ? 'вкл' : 'выкл'}`);
  if (p.capacity != null) lines.push(`  ёмкость: ${p.capacity}, предметов: ${p.items.length}`);
  if (p.hasProtection != null) {
    lines.push(`  защита шкафа: ${p.hasProtection ? `есть, осталось ${until(p.protectionExpiry ?? 0)}` : 'нет (база гниёт)'}`);
  }
  for (const item of p.items.slice(0, 20)) {
    lines.push(`    item ${item.itemId}${item.itemIsBlueprint ? ' (чертёж)' : ''}: ${item.quantity}`);
  }
  return lines.join('\n');
}
