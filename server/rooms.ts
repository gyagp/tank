import { randomInt } from 'node:crypto';
import type { Server, Socket } from 'socket.io';
import { Arena, cleanInput } from '../shared/engine';
import { balanceTeams } from '../shared/tactics';
import { SimulationClock } from './clock';
import {
  COLORS,
  MAX_PLAYERS,
  FIXED_ROOM_CODE,
  type Ack,
  type RoomPlayer,
  type RoomSettings,
  type RoomView,
  type TankClass,
} from '../shared/types';

interface Room {
  view: RoomView;
  arena: Arena | null;
}
const validClass = (v: unknown): TankClass => (v === 'ghost' || v === 'bastion' ? v : 'vanguard');
const safeName = (v: unknown) =>
  typeof v === 'string'
    ? v
        .replace(/[\x00-\x1f<>]/g, '')
        .trim()
        .slice(0, 16) || '指挥官'
    : '指挥官';

export function setupRooms(io: Server) {
  const rooms = new Map<string, Room>();
  const memberships = new Map<string, string>();
  const lastInputs = new Map<string, number>();
  const prepareTeams = (room: Room) => {
    if (room.view.settings.mode === 'control') balanceTeams(room.view.players);
    else
      room.view.players.forEach((p, i) => {
        delete p.team;
        p.color = COLORS[i];
      });
  };
  const emitRoom = (room: Room) => {
    if (room.view.status === 'lobby') prepareTeams(room);
    io.to(room.view.code).emit('room', room.view);
  };
  function leave(socket: Socket) {
    const code = memberships.get(socket.id);
    if (!code) return;
    memberships.delete(socket.id);
    lastInputs.delete(socket.id);
    socket.leave(code);
    const room = rooms.get(code);
    if (!room) return;
    room.view.players = room.view.players.filter((p) => p.id !== socket.id);
    room.arena?.removePlayer(socket.id);
    const humans = room.view.players.filter((p) => !p.bot);
    if (!humans.length) {
      rooms.delete(code);
      return;
    }
    if (room.view.host === socket.id) room.view.host = humans[0].id;
    emitRoom(room);
  }
  function makeBot(room: Room) {
    if (room.view.players.length >= MAX_PLAYERS) return;
    const i = room.view.players.length;
    const names = ['猎隼', '铁锈', '北极星', '野火', '回声', '山猫', '灰狼'];
    const used = new Set(room.view.players.map((p) => p.color));
    room.view.players.push({
      id: `bot-${randomInt(1e9)}`,
      name: `${names[i % 7]} AI`,
      classId: (['vanguard', 'ghost', 'bastion'] as TankClass[])[i % 3],
      bot: true,
      color: COLORS.find((c) => !used.has(c)) || COLORS[0],
    });
  }
  function start(room: Room) {
    prepareTeams(room);
    room.arena = new Arena(room.view.players, room.view.settings);
    room.view.status = 'playing';
    emitRoom(room);
    io.to(room.view.code).emit('state', room.arena.state);
  }
  io.on('connection', (socket) => {
    let lastAction = 0;
    let inputWindowAt = 0;
    let inputCount = 0;
    const respond = (ack: unknown, value: Ack) => {
      if (typeof ack === 'function') ack(value);
    };
    const getRoom = () => rooms.get(memberships.get(socket.id) || '');
    const guarded = (ack: unknown): Room | undefined => {
      const room = getRoom();
      if (!room) {
        respond(ack, { ok: false, error: '你还没有加入房间' });
        return;
      }
      if (room.view.host !== socket.id) {
        respond(ack, { ok: false, error: '只有房主可以操作' });
        return;
      }
      return room;
    };
    socket.on('create', (data: unknown, ack: unknown) => {
      const existing = rooms.get(FIXED_ROOM_CODE);
      if (existing) {
        if (memberships.get(socket.id) === FIXED_ROOM_CODE) {
          socket.emit('room', existing.view);
          if (existing.arena) socket.emit('state', existing.arena.state);
          respond(ack, { ok: true, room: existing.view });
        } else {
          respond(ack, { ok: false, error: '房间 12345 已存在，请选择加入房间' });
        }
        return;
      }
      const now = Date.now();
      if (now - lastAction < 500) {
        respond(ack, { ok: false, error: '操作太快，请稍后重试' });
        return;
      }
      lastAction = now;
      leave(socket);
      const opts = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
      const code = FIXED_ROOM_CODE;
      const player: RoomPlayer = {
        id: socket.id,
        name: safeName(opts.name),
        classId: validClass(opts.classId),
        color: COLORS[0],
        bot: false,
      };
      const settings: RoomSettings = {
        mode: opts.mode === 'control' ? 'control' : 'deathmatch',
        map: opts.map === 'arctic' || opts.map === 'forest' ? opts.map : 'desert',
        difficulty:
          opts.difficulty === 'easy' || opts.difficulty === 'hard' ? opts.difficulty : 'normal',
        goal: 12,
        duration: 180,
      };
      const room: Room = {
        view: { code, host: socket.id, players: [player], settings, status: 'lobby' },
        arena: null,
      };
      rooms.set(code, room);
      memberships.set(socket.id, code);
      socket.join(code);
      const bots = opts.quick
        ? 3
        : typeof opts.bots === 'number'
          ? Math.max(0, Math.min(7, Math.floor(opts.bots)))
          : 0;
      for (let i = 0; i < bots; i++) makeBot(room);
      if (opts.quick) start(room);
      else emitRoom(room);
      respond(ack, { ok: true, room: room.view });
    });
    socket.on('join', (data: unknown, ack: unknown) => {
      const opts = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
      const code = String(opts.code || '')
          .toUpperCase()
          .trim(),
        room = rooms.get(code);
      if (!room) {
        respond(ack, { ok: false, error: '房间不存在，请检查房间码' });
        return;
      }
      if (memberships.get(socket.id) === code) {
        respond(ack, { ok: true, room: room.view });
        return;
      }
      if (room.view.status !== 'lobby') {
        respond(ack, { ok: false, error: '对战已经开始，请等待下一局' });
        return;
      }
      if (room.view.players.length >= MAX_PLAYERS) {
        respond(ack, { ok: false, error: '房间已满（最多 8 人）' });
        return;
      }
      leave(socket);
      const used = new Set(room.view.players.map((p) => p.color));
      room.view.players.push({
        id: socket.id,
        name: safeName(opts.name),
        classId: validClass(opts.classId),
        bot: false,
        color: COLORS.find((c) => !used.has(c)) || COLORS[0],
      });
      memberships.set(socket.id, code);
      socket.join(code);
      emitRoom(room);
      respond(ack, { ok: true, room: room.view });
    });
    socket.on('add-bot', (ack: unknown) => {
      const room = guarded(ack);
      if (!room) return;
      if (room.view.status !== 'lobby') {
        respond(ack, { ok: false, error: '只能在准备阶段添加电脑' });
        return;
      }
      if (room.view.players.length >= MAX_PLAYERS) {
        respond(ack, { ok: false, error: '房间已满' });
        return;
      }
      makeBot(room);
      emitRoom(room);
      respond(ack, { ok: true });
    });
    socket.on('remove-bot', (id: unknown, ack: unknown) => {
      const room = guarded(ack);
      if (!room) return;
      if (room.view.status !== 'lobby') {
        respond(ack, { ok: false, error: '对战已开始' });
        return;
      }
      room.view.players = room.view.players.filter((p) => !(p.id === id && p.bot));
      emitRoom(room);
      respond(ack, { ok: true });
    });
    socket.on('settings', (data: unknown, ack: unknown) => {
      const room = guarded(ack);
      if (!room) return;
      if (room.view.status !== 'lobby') {
        respond(ack, { ok: false, error: '对战已开始' });
        return;
      }
      const v = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>,
        s = room.view.settings;
      if (v.mode === 'control' || v.mode === 'deathmatch') s.mode = v.mode;
      if (v.map === 'desert' || v.map === 'arctic' || v.map === 'forest') s.map = v.map;
      if (v.difficulty === 'easy' || v.difficulty === 'normal' || v.difficulty === 'hard')
        s.difficulty = v.difficulty;
      if (v.goal === 6 || v.goal === 12 || v.goal === 20) s.goal = v.goal;
      if (v.duration === 120 || v.duration === 180 || v.duration === 300) s.duration = v.duration;
      emitRoom(room);
      respond(ack, { ok: true });
    });
    socket.on('start', (ack: unknown) => {
      const room = guarded(ack);
      if (!room) return;
      if (room.view.status === 'playing') {
        respond(ack, { ok: false, error: '对战已开始' });
        return;
      }
      if (room.view.players.length < 2) {
        respond(ack, { ok: false, error: '请添加电脑或邀请至少一名玩家' });
        return;
      }
      start(room);
      respond(ack, { ok: true });
    });
    socket.on('rematch', (ack: unknown) => {
      const room = guarded(ack);
      if (!room) return;
      if (room.view.status !== 'finished') {
        respond(ack, { ok: false, error: '对战尚未结束' });
        return;
      }
      room.arena = null;
      room.view.status = 'lobby';
      emitRoom(room);
      respond(ack, { ok: true });
    });
    socket.on('input', (data: unknown) => {
      const now = Date.now();
      // Accept ordinary packet bursts after a busy frame or network jitter. Simulation still
      // consumes only the latest movement input, and queued buttons survive a later release.
      if (now - inputWindowAt >= 1000) {
        inputWindowAt = now;
        inputCount = 0;
      }
      if (++inputCount > 120) return;
      lastInputs.set(socket.id, now);
      const room = getRoom();
      room?.arena?.setInput(socket.id, cleanInput(data));
    });
    socket.on('ping-check', (ack: unknown) => {
      if (typeof ack === 'function') ack();
    });
    socket.on('leave', (ack: unknown) => {
      leave(socket);
      respond(ack, { ok: true });
    });
    socket.on('disconnect', () => leave(socket));
  });
  const clock = new SimulationClock(performance.now());
  let lastBroadcast = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    const steps = clock.advance(now, (dt) => {
      for (const room of rooms.values()) {
        if (!room.arena || room.view.status !== 'playing') continue;
        for (const p of room.view.players)
          if (!p.bot && Date.now() - (lastInputs.get(p.id) || 0) > 400)
            room.arena.inputs.delete(p.id);
        room.arena.step(dt);
      }
    });
    if (!steps) return;
    const broadcast = now - lastBroadcast >= 1000 / 15 - 1;
    if (broadcast) lastBroadcast = now;
    for (const room of rooms.values())
      if (room.arena && room.view.status === 'playing') {
        if (broadcast || room.arena.state.status === 'finished')
          io.to(room.view.code).emit('state', room.arena.state);
        if (room.arena.state.status === 'finished') {
          room.view.status = 'finished';
          emitRoom(room);
        }
      }
  }, 1000 / 30);
  timer.unref();
  return { rooms, close: () => clearInterval(timer) };
}
