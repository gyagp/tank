import { describe, expect, it } from 'vitest';
import { Arena, cleanInput } from '../shared/engine';
import { allies, balanceTeams, canSpot, clearSight } from '../shared/tactics';
import {
  EMPTY_INPUT,
  OPENING_SUPPLIES,
  PICKUP_TYPES,
  type MapId,
  type RoomPlayer,
  type Weapon,
} from '../shared/types';
import { BattleControls, findAssistTarget } from '../src/game/controls';

const players = (bots = false): RoomPlayer[] =>
  Array.from({ length: 4 }, (_, i) => ({
    id: String(i),
    name: String(i),
    classId: 'vanguard',
    color: 0xef6a3b,
    bot: bots,
  }));
const advance = (g: Arena, seconds: number) => {
  for (let n = 0; n < Math.round(seconds * 30); n++) g.step(1 / 30);
};
function game() {
  const g = new Arena(
    players(),
    { map: 'desert', difficulty: 'normal', goal: 12, duration: 180, mode: 'control' },
    () => 0.5,
  );
  g.state.obstacles = [];
  g.state.pickups = [];
  g.state.tanks.forEach((t, i) =>
    Object.assign(t, { x: -18 + i * 12, z: -18, invulnerableUntil: 0 }),
  );
  return g;
}

describe('team objectives', () => {
  it('balances teams and places each team on its own side', () => {
    const p = Array.from({ length: 8 }, (_, i) => ({ ...players()[0], id: String(i) }));
    balanceTeams(p);
    const g = new Arena(p, {
      map: 'desert',
      difficulty: 'normal',
      goal: 12,
      duration: 180,
      mode: 'control',
    });
    expect(g.state.goal).toBe(180);
    for (const team of ['ember', 'tide']) {
      const members = g.state.tanks.filter((t) => t.team === team);
      expect(members).toHaveLength(4);
      expect(new Set(members.map((t) => t.x + ',' + t.z)).size).toBe(4);
      expect(members.every((t) => (team === 'ember' ? t.z <= 0 : t.z >= 0))).toBe(true);
    }
  });
  it('captures a neutral point in three seconds and earns team income', () => {
    const g = game(),
      t = g.state.tanks[0],
      p = g.state.controlPoints[0];
    Object.assign(t, { x: p.x, z: p.z });
    advance(g, 2.9);
    expect(p.owner).toBe(null);
    expect(p.progress).toBeGreaterThan(0.9);
    advance(g, 0.2);
    expect(p.owner).toBe('ember');
    expect(t.captures).toBe(1);
    const score = g.state.teamScores.ember;
    advance(g, 1);
    expect(g.state.teamScores.ember - score).toBeCloseTo(1, 5);
  });
  it('stops capture and income when contested, and requires neutralization before a takeover', () => {
    const g = game(),
      [a, b] = g.state.tanks,
      p = g.state.controlPoints[1];
    Object.assign(a, { x: 0, z: 0 });
    advance(g, 3.1);
    Object.assign(b, { x: 1, z: 0 });
    const score = g.state.teamScores.ember;
    advance(g, 2);
    expect(p.contested).toBe(true);
    expect(g.state.teamScores.ember).toBe(score);
    expect(p.progress).toBe(0);
    a.z = -15;
    advance(g, 3.1);
    expect(p.owner).toBe(null);
    expect(b.captures).toBe(0);
    advance(g, 3.1);
    expect(p.owner).toBe('tide');
    expect(b.captures).toBe(1);
  });
  it('rewards reinforcements without instantly capturing and ignores dead occupants', () => {
    const g = game(),
      [a, b, c] = g.state.tanks,
      p = g.state.controlPoints[0];
    Object.assign(a, { x: p.x, z: 0 });
    Object.assign(c, { x: p.x + 1, z: 0 });
    Object.assign(b, { x: p.x, z: 0, alive: false, respawnAt: 99 });
    advance(g, 2.3);
    expect(p.owner).toBe(null);
    advance(g, 0.2);
    expect(p.owner).toBe('ember');
    expect(a.captures).toBe(1);
    expect(c.captures).toBe(1);
  });
  it('uses team scores for victory and time-limit ties instead of personal kills', () => {
    const g = game();
    g.state.tanks[1].kills = 100;
    g.step(1 / 30);
    expect(g.state.status).toBe('playing');
    g.state.teamScores.ember = 180;
    g.step(1 / 30);
    expect(g.state.winnerTeam).toBe('ember');
    const tie = game();
    tie.state.time = 180;
    tie.state.teamScores = { ember: 5, tide: 5 };
    tie.step(1 / 30);
    expect(tie.state.status).toBe('finished');
    expect(tie.state.winnerTeam).toBe(null);
    const timed = game();
    timed.state.time = 180;
    timed.state.teamScores = { ember: 5, tide: 6 };
    timed.step(1 / 30);
    expect(timed.state.winnerTeam).toBe('tide');
  });
  it.each(['desert', 'arctic', 'forest'] as const)(
    'bots navigate %s, split objectives and score',
    (map) => {
      const g = new Arena(
        players(true),
        { map, difficulty: 'normal', mode: 'control', goal: 12, duration: 180 },
        () => 0.4,
      );
      advance(g, 50);
      expect(g.state.tanks.reduce((sum, t) => sum + t.captures, 0)).toBeGreaterThanOrEqual(2);
      expect(g.state.teamScores.ember + g.state.teamScores.tide).toBeGreaterThan(5);
      expect(g.state.events.some((e) => e.type === 'capture')).toBe(true);
    },
  );
});

describe('friendly fire and smoke counterplay', () => {
  it.each([
    'standard',
    'scatter',
    'rapid',
    'rail',
    'homing',
    'flame',
    'lightning',
    'ricochet',
    'gravity',
    'cluster',
    'orbital',
  ] as Weapon[])('%s does not harm a teammate standing in the firing line', (weapon) => {
    const g = game(),
      [a, b, c] = g.state.tanks;
    Object.assign(a, { x: 0, z: 0, angle: 0, weapon, weaponUntil: 100 });
    Object.assign(c, { x: 0, z: 2 });
    Object.assign(b, { x: 0, z: 7 });
    g.setInput(a.id, { ...EMPTY_INPUT, fire: true });
    advance(g, 2);
    expect(c.hp).toBe(c.maxHp);
    expect(c.slowUntil).toBe(0);
    if (weapon === 'standard') expect(b.hp).toBeLessThan(b.maxHp);
  });
  it('friendly tanks cannot trigger mines or receive frost and gravity displacement', () => {
    const g = game(),
      [a, b, c] = g.state.tanks;
    Object.assign(a, { x: 0, z: 0 });
    Object.assign(c, { x: 1, z: 0 });
    Object.assign(b, { x: 15, z: 0 });
    g.setInput(a.id, { ...EMPTY_INPUT, mine: true });
    g.setInput(a.id, { ...EMPTY_INPUT });
    advance(g, 1);
    expect(g.state.mines).toHaveLength(1);
    g.applyPickup(a, 'frost');
    expect(c.hp).toBe(c.maxHp);
    expect(c.slowUntil).toBe(0);
    g.state.fields.push({
      id: 999,
      kind: 'gravity',
      owner: a.id,
      x: 0,
      z: 0,
      radius: 5.5,
      createdAt: 0,
      triggerAt: 0,
      expiresAt: 5,
      nextTick: 0,
      damage: 6,
    });
    advance(g, 0.5);
    expect(c.x).toBe(1);
    expect(c.hp).toBe(c.maxHp);
  });
  it('queued smoke conceals enemies from spotting and assisted targeting, while recon, firing and proximity reveal them', () => {
    const g = game(),
      [a, b, c] = g.state.tanks;
    Object.assign(a, { x: 0, z: 0 });
    Object.assign(b, { x: 0, z: 10 });
    Object.assign(c, { x: 5, z: 0 });
    g.setInput(b.id, { ...EMPTY_INPUT, smoke: true });
    g.setInput(b.id, { ...EMPTY_INPUT });
    g.step(1 / 30);
    expect(g.state.fields[0].kind).toBe('smoke');
    expect(b.smokeReadyAt).toBeGreaterThan(12);
    expect(canSpot(g.state, a, b)).toBe(false);
    expect(findAssistTarget(g.state, a.id)?.id).not.toBe(b.id);
    g.setInput(c.id, { ...EMPTY_INPUT, radar: true });
    g.setInput(c.id, { ...EMPTY_INPUT });
    g.step(1 / 30);
    expect(canSpot(g.state, a, b)).toBe(true);
    expect(findAssistTarget(g.state, a.id)?.id).toBe(b.id);
    advance(g, 4.04);
    expect(canSpot(g.state, a, b)).toBe(false);
    g.setInput(b.id, { ...EMPTY_INPUT, fire: true, angle: Math.PI });
    g.step(1 / 30);
    expect(canSpot(g.state, a, b)).toBe(true);
    g.setInput(b.id, { ...EMPTY_INPUT });
    advance(g, 0.84);
    expect(canSpot(g.state, a, b)).toBe(false);
    a.z = 8;
    expect(canSpot(g.state, a, b)).toBe(true);
  });
  it('smoke blocks sight through it but never stops physical projectiles; cooldowns prevent spam', () => {
    const g = game(),
      [a, b] = g.state.tanks;
    Object.assign(a, { x: 0, z: 0 });
    Object.assign(b, { x: 0, z: 8 });
    g.setInput(b.id, { ...EMPTY_INPUT, smoke: true, radar: true });
    g.step(1 / 30);
    const smokeAt = b.smokeReadyAt,
      radarAt = b.radarReadyAt;
    g.setInput(a.id, { ...EMPTY_INPUT, fire: true });
    advance(g, 1);
    expect(b.hp).toBeLessThan(b.maxHp);
    expect(g.state.fields.filter((f) => f.kind === 'smoke')).toHaveLength(1);
    expect(b.smokeReadyAt).toBe(smokeAt);
    expect(b.radarReadyAt).toBe(radarAt);
    g.setInput(b.id, { ...EMPTY_INPUT });
    g.setInput(a.id, { ...EMPTY_INPUT });
    advance(g, 5);
    expect(g.state.fields).toHaveLength(0);
  });
  it('supports separate keyboard and touch skill taps and clears them on focus loss', () => {
    const c = new BattleControls();
    c.keyDown('KeyF');
    c.keyUp('KeyF');
    c.ability('radar', true);
    c.ability('radar', false);
    expect(c.packet()).toMatchObject({ smoke: true, radar: true });
    expect(c.packet()).toMatchObject({ smoke: false, radar: false });
    c.keyDown('KeyG');
    c.reset();
    expect(c.packet()).toMatchObject({ smoke: false, radar: false });
    expect(cleanInput({ smoke: 'true', radar: 1 })).toMatchObject({ smoke: false, radar: false });
  });
  it('clears departed owners ordnance and preserves line of sight cover tests', () => {
    const g = game(),
      [a, b] = g.state.tanks;
    g.state.obstacles = [{ id: 1, x: 0, z: 0, w: 2, d: 2, h: 2, hp: 30, kind: 'crate' }];
    expect(clearSight(g.state, { x: -5, z: 0 }, { x: 5, z: 0 })).toBe(false);
    expect(clearSight(g.state, { x: -5, z: 0 }, { x: 5, z: 0 }, true)).toBe(true);
    expect(clearSight(g.state, { x: -5, z: 4 }, { x: 5, z: 4 })).toBe(true);
    g.setInput(a.id, { ...EMPTY_INPUT, fire: true, mine: true, smoke: true });
    g.step(1 / 30);
    g.removePlayer(a.id);
    expect(g.state.fields).toHaveLength(0);
    expect(g.state.bullets).toHaveLength(0);
    expect(g.state.mines).toHaveLength(0);
    expect(allies(g.state, undefined, b)).toBe(false);
  });
});

describe('abundant, reachable supplies', () => {
  it.each(['desert', 'arctic', 'forest'] as MapId[])(
    'has 24 unobstructed supply stations covering every powerup on %s',
    (map) => {
      const g = new Arena(players(), { map, difficulty: 'normal', goal: 12, duration: 180 });
      expect(g.state.pickups).toHaveLength(24);
      expect(g.state.pickups.filter((p) => p.support)).toHaveLength(8);
      expect(new Set(OPENING_SUPPLIES).size).toBe(PICKUP_TYPES.length);
      for (const p of g.state.pickups) expect(g.blocked(p), `blocked supply ${p.id}`).toBe(false);
    },
  );
  it('refills support in under five seconds and weapons in under six, preserving support roles', () => {
    const g = new Arena(
      players(),
      { map: 'desert', difficulty: 'normal', goal: 12, duration: 180 },
      () => 0.5,
    );
    const t = g.state.tanks[0],
      support = g.state.pickups[16],
      weapon = g.state.pickups[0];
    Object.assign(t, { x: support.x, z: support.z, hp: 10 });
    g.step(1 / 30);
    expect(support.active).toBe(false);
    const kind = support.kind;
    Object.assign(t, { x: weapon.x, z: weapon.z });
    g.step(1 / 30);
    expect(weapon.active).toBe(false);
    Object.assign(t, { x: -22, z: -22 });
    advance(g, 4.5);
    expect(support.active).toBe(true);
    expect(support.kind).toBe(kind);
    advance(g, 1.1);
    expect(weapon.active).toBe(true);
  });
  it('leaves repair and mines for teammates when already fully supplied', () => {
    const g = new Arena(players(), {
      map: 'desert',
      difficulty: 'normal',
      goal: 12,
      duration: 180,
    });
    const t = g.state.tanks[0],
      p = g.state.pickups[16];
    Object.assign(t, { x: p.x, z: p.z });
    g.step(1 / 30);
    expect(p.active).toBe(true);
    p.kind = 'mines';
    t.mines = 3;
    g.step(1 / 30);
    expect(p.active).toBe(true);
  });
});
