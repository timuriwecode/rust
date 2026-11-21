#!/usr/bin/env -S npx tsx
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  formatGameTime,
  HandshakeError,
  isExpired,
  LOGIN_URL,
  parseAuthToken,
  Recorder,
  RustPlusClient,
  RustPlusError,
  type Endpoint,
} from '@rcomp/core';
import { FAKE_PLAYER, FAKE_TEAMMATE_ID, FakeRustServer } from '@rcomp/core/testing';
import {
  ConfigStore,
  createFcmCredentials,
  getExpoPushToken,
  PairingListener,
  registerWithCompanion,
  type StoredServer,
} from '@rcomp/pairing';
import {
  formatChat,
  formatEntity,
  formatInfo,
  formatMarkerList,
  formatMarkers,
  formatTeam,
  formatTime,
  until,
} from './format.ts';

const USAGE = `rcomp — консольная утилита Rust Companion (этап 0)

Вход и сопряжение:
  rcomp login-url                     Как получить токен входа Rust+ (Steam)
  rcomp auth <токен | rust-plus://…>  Сохранить токен входа Rust+
  rcomp import <rustplus.config.json> Импорт учётных данных из rustplus.js
  rcomp register                      Зарегистрировать этот ПК для push-уведомлений Rust+
  rcomp listen                        Ждать уведомлений о сопряжении и сигнализаций
  rcomp servers                       Список сопряжённых серверов и устройств
  rcomp use <сервер>                  Выбрать сервер по умолчанию

Работа с сервером:
  rcomp status                        Сводка: сервер, время, команда, маркеры
  rcomp markers                       Все маркеры карты
  rcomp chat [сообщение]              Показать командный чат или отправить сообщение
  rcomp entity <id> [on|off]          Прочитать или переключить смарт-устройство
  rcomp map [--out map.jpg]           Сохранить изображение карты
  rcomp record [--minutes 10] [--interval 10] [--out file.jsonl] [--redact]
                                      Записать трафик сервера для тестов

Разработка:
  rcomp fake-server [--port 28082]    Локальный фейковый сервер Rust+ (без игры)

Общие опции:
  --server <имя|id>     какой сервер использовать (по умолчанию — выбранный)
  --direct <host:port>  подключиться напрямую (локальный/фейковый сервер), без relay
  --config <путь>       файл настроек (по умолчанию в папке пользователя, RCOMP_HOME)
`;

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    server: { type: 'string' },
    direct: { type: 'string' },
    config: { type: 'string' },
    out: { type: 'string' },
    port: { type: 'string' },
    minutes: { type: 'string' },
    interval: { type: 'string' },
    redact: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
});

const [command, ...args] = positionals;

function fail(message: string): never {
  console.error(`Ошибка: ${message}`);
  process.exit(1);
}

function openStore(): ConfigStore {
  return opts.config ? new ConfigStore(opts.config) : new ConfigStore();
}

function describeError(error: unknown): string {
  if (error instanceof HandshakeError) {
    if (error.status === 401 || error.status === 403) {
      return `relay отклонил подключение (HTTP ${error.status}). Скорее всего токен входа Rust+ истёк или неверен: получите новый (rcomp login-url).`;
    }
    return error.message;
  }
  if (error instanceof RustPlusError) return `сервер вернул ошибку "${error.code}"`;
  return error instanceof Error ? error.message : String(error);
}

interface Connection {
  client: RustPlusClient;
  server: StoredServer | null;
}

async function connect(store: ConfigStore): Promise<Connection> {
  let endpoint: Endpoint;
  let server: StoredServer | null = null;
  let playerId: string;
  let playerToken: number;

  if (opts.direct) {
    const [host, port] = opts.direct.split(':');
    if (!host || !port) fail('--direct ожидает host:port');
    endpoint = { kind: 'direct', host, port: Number(port) };
    server = store.resolveServer(opts.server) ?? null;
    playerId = server?.playerId ?? FAKE_PLAYER.playerId;
    playerToken = server?.playerToken ?? FAKE_PLAYER.playerToken;
  } else {
    server = store.resolveServer(opts.server) ?? null;
    if (!server) fail('нет сопряжённых серверов. Сначала: rcomp register, затем rcomp listen и «Pair with Server» в игре.');
    const auth = store.config.auth;
    if (!auth) fail('нет токена входа Rust+. Получите его: rcomp login-url');
    if (isExpired({ ...auth, issuedAt: null })) fail('токен входа Rust+ истёк. Получите новый: rcomp login-url');
    if (!server.relayId) {
      fail('у этого сервера нет relay id (сопряжение до 5 ноября 2026). Сделайте «Pair with Server» в игре ещё раз.');
    }
    endpoint = { kind: 'relay', serverId: server.relayId, authToken: auth.token };
    playerId = server.playerId;
    playerToken = server.playerToken;
  }

  const client = new RustPlusClient({ endpoint, playerId, playerToken });
  try {
    await client.connect();
  } catch (error) {
    fail(`не удалось подключиться: ${describeError(error)}`);
  }
  return { client, server };
}

async function withClient(fn: (conn: Connection) => Promise<void>): Promise<void> {
  const conn = await connect(openStore());
  try {
    await fn(conn);
  } catch (error) {
    fail(describeError(error));
  } finally {
    conn.client.disconnect();
  }
}

// ---- Commands ---------------------------------------------------------------

function cmdLoginUrl(): void {
  console.log(`Токен входа Rust+ (живёт ~14 дней) выдаётся после входа через Steam.

1. Откройте в браузере инструменты разработчика (F12) → вкладка Network,
   включите «Preserve log».
2. Перейдите по ссылке и войдите через Steam:
   ${LOGIN_URL}
3. В конце сайт перенаправит на ссылку вида
   rust-plus://rust-auth-session/?token=…&steamId=…
   Браузер не сможет её открыть — это нормально. Найдите в Network запрос
   к /app, в заголовке ответа Location будет эта ссылка. Скопируйте её целиком.
4. rcomp auth "rust-plus://rust-auth-session/?token=…"

Не публикуйте токен и не отправляйте его в чат: он даёт доступ к Rust+
от вашего имени. Хранится только локально: ${openStore().path}

Известная проблема (с октября 2026): на Windows шаг /app может ответить
«Login Failed». Обсудим варианты, если столкнётесь.`);
}

function cmdAuth(): void {
  const input = args[0] ?? fail('укажите токен или ссылку rust-plus://…');
  if (!parseAuthToken(input)) fail('это не похоже на токен Rust+. Нужна ссылка rust-plus://rust-auth-session/?token=… или сам токен.');
  const store = openStore();
  const info = store.setAuthToken(input);
  store.save();
  console.log(`Токен сохранён. SteamID: ${info.steamId ?? 'не указан'}`);
  if (info.expiresAt) console.log(`Действует ещё: ${until(info.expiresAt)} (до ${new Date(info.expiresAt * 1000).toLocaleString()})`);
}

function cmdImport(): void {
  const path = args[0] ?? 'rustplus.config.json';
  const store = openStore();
  store.importRustplusJsConfig(JSON.parse(readFileSync(path, 'utf8')));
  store.save();
  console.log(`Импортировано: FCM ${store.config.fcm ? 'да' : 'нет'}, токен входа ${store.config.auth ? 'да' : 'нет'}.`);
}

async function cmdRegister(): Promise<void> {
  const store = openStore();
  const auth = store.config.auth ?? fail('сначала сохраните токен входа: rcomp login-url');
  console.log('1/3 Регистрация FCM…');
  const fcm = await createFcmCredentials();
  console.log('2/3 Получение Expo push token…');
  const expoPushToken = await getExpoPushToken(fcm.fcmToken, randomUUID());
  console.log('3/3 Регистрация в Rust Companion API…');
  await registerWithCompanion(auth.token, expoPushToken);
  store.config.fcm = { ...fcm, expoPushToken, registeredAt: new Date().toISOString() };
  store.save();
  console.log('Готово. Теперь запустите «rcomp listen» и в игре: Esc → Rust+ → Pair with Server.');
}

async function cmdListen(): Promise<void> {
  const store = openStore();
  const fcm = store.config.fcm ?? fail('нет FCM-регистрации: rcomp register (или rcomp import)');
  const listener = new PairingListener(fcm, store.config.persistentIds);
  listener.on('connected', () => console.log('Подключено к FCM. Жду уведомлений (Ctrl+C — выход)…'));
  listener.on('disconnected', () => console.log('FCM отключён, переподключение…'));
  listener.on('push', (event, persistentId) => {
    store.rememberPersistentId(persistentId);
    const stamp = new Date().toLocaleTimeString();
    switch (event.kind) {
      case 'serverPaired':
        console.log(`[${stamp}] Сервер сопряжён: ${event.server.name} (${event.server.relayId ? 'relay id есть' : 'без relay id'})`);
        break;
      case 'entityPaired':
        console.log(`[${stamp}] Устройство сопряжено: ${event.entity.entityName || 'без имени'} #${event.entity.entityId} на ${event.server.name}`);
        break;
      case 'alarm':
        console.log(`\x07[${stamp}] СИГНАЛИЗАЦИЯ: ${event.title} — ${event.message}`);
        break;
      default:
        console.log(`[${stamp}] Уведомление (${event.channelId || 'без канала'}): ${event.title} ${event.message}`);
    }
    store.apply(event);
    store.save();
  });
  process.on('SIGINT', () => {
    listener.stop();
    store.save();
    process.exit(0);
  });
  await listener.start();
}

function cmdServers(): void {
  const store = openStore();
  const servers = Object.values(store.config.servers);
  const auth = store.config.auth;
  console.log(
    `Токен входа: ${auth ? (auth.expiresAt ? `действует ещё ${until(auth.expiresAt)}` : 'есть') : 'нет'}; ` +
      `push-регистрация: ${store.config.fcm ? 'есть' : 'нет'}; файл: ${store.path}`,
  );
  if (servers.length === 0) return console.log('Сопряжённых серверов нет.');
  for (const s of servers) {
    const active = s.key === store.config.activeServer ? '*' : ' ';
    console.log(`${active} ${s.name}  [${s.relayId ? `relay ${s.relayId}` : `${s.ip}:${s.port}, без relay id`}]`);
    for (const e of Object.values(s.entities)) {
      console.log(`      #${e.entityId} ${e.entityName || ''} (тип ${e.entityType})`);
    }
  }
}

function cmdUse(): void {
  const store = openStore();
  const server = store.resolveServer(args[0] ?? fail('укажите сервер')) ?? fail('сервер не найден');
  store.config.activeServer = server.key;
  store.save();
  console.log(`Сервер по умолчанию: ${server.name}`);
}

async function cmdStatus(): Promise<void> {
  await withClient(async ({ client }) => {
    const info = await client.getInfo();
    const [time, team, markers] = await Promise.all([client.getTime(), client.getTeamInfo(), client.getMapMarkers()]);
    console.log([formatInfo(info), formatTime(time), formatTeam(team, info.mapSize), formatMarkers(markers)].join('\n'));
  });
}

async function cmdMarkers(): Promise<void> {
  await withClient(async ({ client }) => {
    const info = await client.getInfo();
    const markers = await client.getMapMarkers();
    console.log(formatMarkers(markers));
    if (markers.length) console.log(formatMarkerList(markers, info.mapSize));
  });
}

async function cmdChat(): Promise<void> {
  await withClient(async ({ client }) => {
    if (args.length) {
      await client.sendTeamMessage(args.join(' '));
      console.log('Отправлено.');
    } else {
      console.log(formatChat(await client.getTeamChat()));
    }
  });
}

async function cmdEntity(): Promise<void> {
  const id = args[0] ?? fail('укажите id устройства (см. rcomp servers)');
  const action = args[1];
  await withClient(async ({ client }) => {
    if (action === 'on' || action === 'off') await client.setEntityValue(id, action === 'on');
    else if (action) fail('действие: on или off');
    console.log(formatEntity(id, await client.getEntityInfo(id)));
  });
}

async function cmdMap(): Promise<void> {
  await withClient(async ({ client }) => {
    const map = await client.getMap();
    const out = opts.out ?? 'map.jpg';
    writeFileSync(out, map.jpgImage);
    console.log(`Карта ${map.width}×${map.height}, монументов: ${map.monuments.length}. Сохранено в ${out}`);
  });
}

async function cmdRecord(): Promise<void> {
  const minutes = Number(opts.minutes ?? 10);
  const intervalS = Math.max(2, Number(opts.interval ?? 10));
  await withClient(async ({ client, server }) => {
    const slug = (server?.name ?? 'direct').replace(/[^\w-]+/g, '_').slice(0, 40);
    const out = opts.out ?? join('recordings', `${slug}-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);
    const recorder = new Recorder(out, { redact: Boolean(opts.redact) });
    client.on('request', (name, body) => recorder.write('out', { name, body }));
    client.on('message', (message) => recorder.write('in', message));
    recorder.write('note', { started: true, intervalS, minutes, server: server?.name ?? opts.direct });

    const stop = new Promise<void>((resolve) => {
      process.once('SIGINT', resolve);
      setTimeout(resolve, minutes * 60_000);
      client.once('disconnected', () => resolve());
    });
    console.log(`Запись в ${out} на ${minutes} мин, опрос каждые ${intervalS} с (Ctrl+C — стоп)…`);

    const info = await client.getInfo();
    const map = await client.getMap();
    recorder.write('note', { monuments: map.monuments.length, mapSize: info.mapSize });
    for (const entityId of Object.keys(server?.entities ?? {})) {
      await client.getEntityInfo(entityId).catch(() => undefined);
    }

    let polls = 0;
    const poll = async () => {
      const [time] = await Promise.all([client.getTime(), client.getTeamInfo(), client.getMapMarkers()]);
      polls++;
      process.stdout.write(`\rОпросов: ${polls}, игровое время ${formatGameTime(time.time)}   `);
    };
    await poll();
    const timer = setInterval(() => poll().catch((e) => recorder.write('note', { error: describeError(e) })), intervalS * 1000);
    await stop;
    clearInterval(timer);
    recorder.write('note', { stopped: true, polls });
    await recorder.close();
    console.log(`\nГотово: ${out}`);
  });
}

async function cmdFakeServer(): Promise<void> {
  const port = Number(opts.port ?? 28082);
  const server = new FakeRustServer({ port, player: FAKE_PLAYER });
  await server.start();
  console.log(`Фейковый сервер Rust+ слушает ws://127.0.0.1:${server.port}
Попробуйте в другом терминале:
  npm run cli -- status --direct 127.0.0.1:${server.port}
Каждые 20 с он имитирует события: сообщение в чат, сигнализацию, смерть тиммейта.`);
  let tick = 0;
  setInterval(() => {
    tick++;
    const t = server.state.time;
    t.time = (Number(t.time) + 0.25) % 24;
    if (tick % 3 === 0) server.postTeamMessage('Teammate', `тестовое сообщение #${tick / 3}`);
    if (tick % 3 === 1) server.setEntity('1002', { value: tick % 2 === 1 });
    if (tick % 3 === 2) server.updateTeamMember(FAKE_TEAMMATE_ID, { isAlive: tick % 2 === 0, deathTime: Math.floor(Date.now() / 1000) });
  }, 20_000);
  process.on('SIGINT', () => void server.stop().then(() => process.exit(0)));
}

const commands: Record<string, () => void | Promise<void>> = {
  'login-url': cmdLoginUrl,
  auth: cmdAuth,
  import: cmdImport,
  register: cmdRegister,
  listen: cmdListen,
  servers: cmdServers,
  use: cmdUse,
  status: cmdStatus,
  markers: cmdMarkers,
  chat: cmdChat,
  entity: cmdEntity,
  map: cmdMap,
  record: cmdRecord,
  'fake-server': cmdFakeServer,
};

const run = command ? commands[command] : undefined;
if (opts.help || !run) {
  console.log(USAGE);
  process.exit(command && !run ? 1 : 0);
}
Promise.resolve()
  .then(run)
  .catch((error: unknown) => fail(describeError(error)));
