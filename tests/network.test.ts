import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { io as client, type Socket } from 'socket.io-client';
import { createGameServer } from '../server/index';
import type { Ack, GameState, RoomView } from '../shared/types';

let server: ReturnType<typeof createGameServer>, url: string;
const clients: Socket[] = [];
const emit = (socket: Socket, event: string, data?: unknown): Promise<Ack> =>
  new Promise((resolve, reject) => {
    const callback = (error: Error | null, ack: Ack) => (error ? reject(error) : resolve(ack));
    if (data === undefined) socket.timeout(2000).emit(event, callback);
    else socket.timeout(2000).emit(event, data, callback);
  });
const next = <T>(
  socket: Socket,
  event: string,
  accept: (value: T) => boolean = () => true,
): Promise<T> =>
  new Promise((resolve, reject) => {
    const listener = (value: T) => {
      if (!accept(value)) return;
      clearTimeout(timer);
      socket.off(event, listener);
      resolve(value);
    };
    const timer = setTimeout(() => {
      socket.off(event, listener);
      reject(new Error(`No ${event} event`));
    }, 3000);
    socket.on(event, listener);
  });
async function connect() {
  const socket = client(url, { transports: ['websocket'], forceNew: true });
  clients.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.on('connect', resolve);
    socket.on('connect_error', reject);
  });
  return socket;
}
beforeEach(async () => {
  server = createGameServer();
  await new Promise<void>((resolve) => server.http.listen(0, '127.0.0.1', resolve));
  const address = server.http.address();
  url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});
afterEach(async () => {
  clients.splice(0).forEach((s) => s.disconnect());
  server.manager.close();
  await new Promise<void>((resolve) => server.io.close(() => resolve()));
});

describe('real Socket.IO multiplayer', () => {
  it('keeps mode host-authoritative and synchronizes balanced teams, capture scores and smoke', async () => {
    const a = await connect(),
      b = await connect();
    await emit(a, 'create', { mode: 'control', bots: 2 });
    await emit(b, 'join', { code: '12345', team: 'ember' });
    expect((await emit(b, 'settings', { mode: 'deathmatch' })).ok).toBe(false);
    const room = server.manager.rooms.get('12345')!;
    expect(room.view.players.filter((p) => p.team === 'ember')).toHaveLength(2);
    expect(room.view.players.filter((p) => p.team === 'tide')).toHaveLength(2);
    await emit(a, 'start');
    const g = room.arena!;
    g.state.tanks.forEach((t, i) =>
      Object.assign(t, { bot: false, x: -18 + i * 12, z: -18, invulnerableUntil: 0 }),
    );
    Object.assign(g.state.tanks[0], { x: -12, z: 0 });
    const p = g.state.controlPoints[0];
    p.capturing = 'ember';
    p.progress = 0.999;
    const one = next<GameState>(
      a,
      'state',
      (s) => s.controlPoints[0].owner === 'ember' && s.fields.some((f) => f.kind === 'smoke'),
    );
    const two = next<GameState>(
      b,
      'state',
      (s) => s.controlPoints[0].owner === 'ember' && s.fields.some((f) => f.kind === 'smoke'),
    );
    a.emit('input', { smoke: true, radar: true });
    const [sa, sb] = await Promise.all([one, two]);
    expect(sa.mode).toBe('control');
    expect(sa.teamScores).toEqual(sb.teamScores);
    expect(sa.fields).toEqual(sb.fields);
    expect(sa.teamScores.ember).toBeGreaterThan(0);
  });

  it('uses 12345 without overwriting an existing room or changing its host', async () => {
    const a = await connect(),
      b = await connect();
    const created = await emit(a, 'create', { name: 'Original', map: 'forest' });
    expect(created.room!.code).toBe('12345');
    const original = server.manager.rooms.get('12345');
    const refused = await emit(b, 'create', { quick: true, map: 'arctic' });
    expect(refused.ok).toBe(false);
    expect(refused.error).toContain('12345');
    expect(server.manager.rooms.get('12345')).toBe(original);
    expect(original!.view.players).toHaveLength(1);
    expect(original!.view.host).toBe(a.id);
    expect(original!.view.settings.map).toBe('forest');
    expect((await emit(b, 'join', { code: '12345' })).ok).toBe(true);
  });
  it('returns the existing match for a repeated create by its member', async () => {
    const a = await connect();
    await emit(a, 'create', { quick: true });
    const room = server.manager.rooms.get('12345')!,
      arena = room.arena;
    const again = await emit(a, 'create', {});
    expect(again.ok).toBe(true);
    expect(again.room!.status).toBe('playing');
    expect(room.arena).toBe(arena);
    expect(room.view.players).toHaveLength(4);
  });
  it('reuses 12345 after cleanup and rejects longer aliases', async () => {
    const a = await connect(),
      b = await connect();
    await emit(a, 'create', {});
    expect((await emit(b, 'join', { code: '12345-extra' })).ok).toBe(false);
    await emit(a, 'leave');
    const fresh = await emit(b, 'create', { quick: true });
    expect(fresh.room!.code).toBe('12345');
    expect(fresh.room!.host).toBe(b.id);
    expect(server.manager.rooms.size).toBe(1);
  });
  it('broadcasts the same gravity field and resulting damage to both clients', async () => {
    const a = await connect(),
      b = await connect();
    const created = await emit(a, 'create', {});
    await emit(b, 'join', { code: created.room!.code });
    await emit(a, 'start');
    const arena = server.manager.rooms.get(created.room!.code)!.arena!;
    arena.state.obstacles = [];
    arena.state.pickups = [];
    Object.assign(arena.state.tanks[0], { x: 0, z: 0, invulnerableUntil: 0 });
    Object.assign(arena.state.tanks[1], { x: 0, z: 12, invulnerableUntil: 0 });
    arena.applyPickup(arena.state.tanks[0], 'gravity');
    const one = next<GameState>(a, 'state', (s) => s.fields.length > 0),
      two = next<GameState>(b, 'state', (s) => s.fields.length > 0);
    a.emit('input', { x: 0, z: 0, angle: 0, fire: true });
    const [sa, sb] = await Promise.all([one, two]);
    expect(sa.fields).toEqual(sb.fields);
    expect(sa.fields[0].owner).toBe(a.id);
    expect(sa.tanks[1].hp).toBeLessThan(100);
  });
  it('preserves a tap when network buffering delivers press and release packets together', async () => {
    const a = await connect();
    const created = await emit(a, 'create', { quick: true });
    const arena = server.manager.rooms.get(created.room!.code)!.arena!;
    a.emit('input', { x: 0, z: 0, angle: 0, mine: false });
    a.emit('input', { x: 0, z: 0, angle: 0, mine: true });
    a.emit('input', { x: 0, z: 0, angle: 0, mine: false });
    await next<GameState>(a, 'state', (state) => state.mines.some((m) => m.owner === a.id));
    expect(arena.state.tanks.find((t) => t.id === a.id)!.mines).toBe(1);
  });
  it('two independent clients share a room, bots and the same authoritative match', async () => {
    const a = await connect(),
      b = await connect();
    const created = await emit(a, 'create', { name: 'Alpha', classId: 'ghost', map: 'arctic' });
    expect(created.ok).toBe(true);
    const code = created.room!.code;
    expect(code).toBe('12345');
    const updated = next<RoomView>(a, 'room');
    expect(
      (await emit(b, 'join', { code: code.toLowerCase(), name: 'Bravo', classId: 'bastion' })).ok,
    ).toBe(true);
    expect((await updated).players).toHaveLength(2);
    expect((await emit(a, 'add-bot')).ok).toBe(true);
    expect((await emit(a, 'settings', { difficulty: 'hard', goal: 6 })).ok).toBe(true);
    const stateA = next<GameState>(a, 'state'),
      stateB = next<GameState>(b, 'state');
    expect((await emit(a, 'start')).ok).toBe(true);
    const [one, two] = await Promise.all([stateA, stateB]);
    expect(one).toEqual(two);
    expect(one.tanks).toHaveLength(3);
    expect(one.map).toBe('arctic');
    expect(one.goal).toBe(6);
    a.emit('input', { x: 1, z: 0, angle: 1, fire: true });
    await new Promise((r) => setTimeout(r, 160));
    const state = await next<GameState>(b, 'state');
    expect(state.tanks.find((t) => t.id === a.id)!.x).toBeGreaterThan(
      one.tanks.find((t) => t.id === a.id)!.x,
    );
    expect(state.events.some((e) => e.type === 'shot' && e.actor === a.id)).toBe(true);
  });
  it('enforces host-only controls and lobby-only joins', async () => {
    const a = await connect(),
      b = await connect(),
      c = await connect();
    const created = await emit(a, 'create', {});
    await emit(b, 'join', { code: created.room!.code });
    for (const action of ['add-bot', 'start', 'rematch'])
      expect((await emit(b, action)).ok).toBe(false);
    expect((await emit(b, 'settings', { goal: 20 })).ok).toBe(false);
    await emit(a, 'start');
    expect((await emit(c, 'join', { code: created.room!.code })).ok).toBe(false);
    expect((await emit(a, 'add-bot')).ok).toBe(false);
    expect((await emit(a, 'start')).ok).toBe(false);
  });
  it('transfers host ownership and recycles a room with no humans', async () => {
    const a = await connect(),
      b = await connect();
    const created = await emit(a, 'create', {}),
      code = created.room!.code;
    await emit(b, 'join', { code });
    await emit(a, 'add-bot');
    const changed = next<RoomView>(b, 'room', (room) => room.host === b.id);
    await emit(a, 'leave');
    expect((await changed).host).toBe(b.id);
    expect((await emit(b, 'settings', { map: 'forest' })).ok).toBe(true);
    await emit(b, 'leave');
    expect(server.manager.rooms.has(code)).toBe(false);
  });
  it('limits total players, rejects invalid codes, and safely handles malformed payloads', async () => {
    const a = await connect(),
      b = await connect();
    expect((await emit(b, 'join', { code: 'XXXXX' })).ok).toBe(false);
    const created = await emit(a, 'create', { name: '<script>\nTest', classId: 'invalid' });
    expect(created.room!.players[0].name).not.toContain('<');
    expect(created.room!.players[0].classId).toBe('vanguard');
    for (let i = 0; i < 7; i++) expect((await emit(a, 'add-bot')).ok).toBe(true);
    expect((await emit(a, 'add-bot')).ok).toBe(false);
    expect((await emit(b, 'join', { code: created.room!.code })).ok).toBe(false);
    expect((await emit(a, 'settings', { map: 'invalid', duration: -1, goal: 99999 })).ok).toBe(
      true,
    );
    expect(server.manager.rooms.get(created.room!.code)!.view.settings.goal).toBe(12);
  });
  it('finishes authoritatively, allows a rematch, and resets score and arena', async () => {
    const a = await connect();
    const created = await emit(a, 'create', { quick: true }),
      code = created.room!.code;
    const room = server.manager.rooms.get(code)!;
    expect(room.view.status).toBe('playing');
    room.arena!.state.time = 180;
    room.arena!.state.tanks[0].kills = 4;
    const finished = await next<RoomView>(a, 'room');
    expect(finished.status).toBe('finished');
    expect(room.arena!.state.winner).toBe(a.id);
    expect((await emit(a, 'rematch')).ok).toBe(true);
    expect(room.view.status).toBe('lobby');
    expect(room.arena).toBeNull();
    expect((await emit(a, 'start')).ok).toBe(true);
    expect(room.arena!.state.tanks.every((t) => t.kills === 0)).toBe(true);
    expect(room.arena!.state.time).toBeLessThan(1);
  });
  it('clears stale input and removes disconnected players from an active match', async () => {
    const a = await connect(),
      b = await connect();
    const created = await emit(a, 'create', {}),
      code = created.room!.code;
    await emit(b, 'join', { code });
    await emit(a, 'start');
    const arena = server.manager.rooms.get(code)!.arena!;
    a.emit('input', { x: 1, z: 0, angle: 0, fire: false });
    await new Promise((r) => setTimeout(r, 550));
    expect(arena.inputs.has(a.id!)).toBe(false);
    const id = b.id;
    b.disconnect();
    await new Promise((r) => setTimeout(r, 70));
    expect(arena.state.tanks.some((t) => t.id === id)).toBe(false);
  });
});
