import { describe, expect, it } from 'vitest';
import { Arena } from '../shared/engine';
import { EMPTY_INPUT, PICKUP_TYPES, type RoomPlayer, type Weapon } from '../shared/types';

function fixture(count = 2, random = () => 0.4) {
  const players: RoomPlayer[] = Array.from({ length: count }, (_, i) => ({
    id: `p${i}`,
    name: `P${i}`,
    bot: false,
    classId: 'vanguard',
    color: 0x88bb99,
  }));
  const game = new Arena(
    players,
    { map: 'desert', difficulty: 'normal', goal: 50, duration: 180 },
    random,
  );
  game.state.time = 3;
  game.state.obstacles = [];
  game.state.pickups = [];
  game.state.tanks.forEach((t, i) =>
    Object.assign(t, { x: i === 0 ? -10 : -3 + (i - 1) * 4, z: 0, invulnerableUntil: 0 }),
  );
  return game;
}
const advance = (g: Arena, seconds: number) => {
  for (let i = 0; i < Math.round(seconds * 30); i++) g.step(1 / 30);
};
function fire(g: Arena, weapon: Exclude<Weapon, 'standard'>, angle = Math.PI / 2) {
  const t = g.state.tanks[0];
  g.applyPickup(t, weapon);
  t.nextFire = 0;
  g.inputs.set(t.id, { ...EMPTY_INPUT, angle, fire: true });
  g.step(1 / 30);
  g.inputs.clear();
}

describe('experimental weapons and counterplay', () => {
  it('chains lightning to three distinct enemies with decreasing damage', () => {
    const g = fixture(5);
    fire(g, 'lightning');
    expect(g.state.tanks[1].hp).toBe(68);
    expect(g.state.tanks[2].hp).toBeCloseTo(76.96);
    expect(g.state.tanks[3].hp).toBeGreaterThan(g.state.tanks[2].hp);
    expect(g.state.tanks[4].hp).toBe(100);
    expect(g.state.events.filter((e) => e.type === 'arc')).toHaveLength(3);
  });
  it('solid cover prevents a lightning hit', () => {
    const g = fixture();
    g.state.obstacles = [{ id: 9, x: -6, z: 0, w: 1, d: 5, h: 2, hp: -1, kind: 'wall' }];
    fire(g, 'lightning');
    expect(g.state.tanks[1].hp).toBe(100);
    const arc = g.state.events.find((e) => e.type === 'arc')!;
    expect(arc.toX).toBeLessThan(-6.5);
  });
  it('ricochet reflects off a wall and can hit a target behind the shooter', () => {
    const g = fixture();
    g.state.tanks[0].x = -6;
    g.state.tanks[1].x = -12;
    g.state.obstacles = [{ id: 1, x: 0, z: 0, w: 1, d: 8, h: 2, hp: -1, kind: 'wall' }];
    fire(g, 'ricochet');
    advance(g, 0.8);
    expect(g.state.tanks[1].hp).toBe(73);
    expect(g.state.events.some((e) => e.type === 'hit' && e.label === 'ricochet')).toBe(true);
  });
  it('ricochet ammunition remains inside the arena and eventually expires', () => {
    const g = fixture();
    g.state.tanks[1].z = 20;
    fire(g, 'ricochet');
    for (let i = 0; i < 150; i++) {
      g.step(1 / 30);
      for (const b of g.state.bullets) {
        expect(Math.abs(b.x)).toBeLessThanOrEqual(24);
        expect(Math.abs(b.z)).toBeLessThanOrEqual(24);
      }
    }
    expect(g.state.bullets).toHaveLength(0);
  });
  it('cluster ammunition splits once into six bounded short-lived fragments', () => {
    const g = fixture();
    g.state.tanks[0].z = -15;
    g.state.tanks[1].x = 20;
    g.state.tanks[1].z = -20;
    fire(g, 'cluster', 0);
    advance(g, 1.27);
    expect(
      g.state.events.filter((e) => e.type === 'explosion' && e.label === 'cluster'),
    ).toHaveLength(1);
    expect(g.state.bullets).toHaveLength(6);
    expect(g.state.bullets.every((b) => b.kind === 'standard' && b.damage === 10)).toBe(true);
    advance(g, 0.6);
    expect(g.state.bullets).toHaveLength(0);
  });
  it('gravity attracts and damages enemies while a shield prevents both effects', () => {
    const g = fixture(3);
    Object.assign(g.state.tanks[0], { x: 0, z: 0 });
    Object.assign(g.state.tanks[1], { x: 2, z: 12 });
    Object.assign(g.state.tanks[2], { x: -2, z: 12, shieldUntil: 100 });
    fire(g, 'gravity', 0);
    advance(g, 0.67);
    expect(g.state.fields[0].kind).toBe('gravity');
    const f = g.state.fields[0],
      t = g.state.tanks[1],
      gap = Math.hypot(t.x - f.x, t.z - f.z);
    advance(g, 0.5);
    expect(Math.hypot(t.x - f.x, t.z - f.z)).toBeLessThan(gap);
    expect(t.hp).toBeLessThan(100);
    expect(g.state.tanks[2].x).toBe(-2);
    expect(g.state.tanks[2].hp).toBe(100);
    expect(g.state.tanks[0].hp).toBe(100);
  });
  it('gravity cannot drag tanks through solid cover', () => {
    const g = fixture();
    Object.assign(g.state.tanks[0], { x: 0, z: 0 });
    Object.assign(g.state.tanks[1], { x: 2, z: 12 });
    fire(g, 'gravity', 0);
    advance(g, 0.67);
    g.state.obstacles = [{ id: 1, x: 1, z: 12, w: 0.4, d: 8, h: 2, hp: -1, kind: 'wall' }];
    g.state.tanks[1].x = 2;
    advance(g, 0.7);
    expect(g.blocked(g.state.tanks[1])).toBe(false);
    expect(g.state.tanks[1].x).toBeGreaterThanOrEqual(1.98);
  });
  it('orbital strike gives a warning and permits escape before dealing damage', () => {
    const g = fixture();
    fire(g, 'orbital');
    expect(g.state.fields[0].kind).toBe('orbital');
    advance(g, 0.5);
    expect(g.state.tanks[1].hp).toBe(100);
    g.state.tanks[1].z = 15;
    advance(g, 0.5);
    expect(g.state.tanks[1].hp).toBe(100);
    expect(g.state.fields).toHaveLength(0);
    g.state.tanks[1].z = 0;
    fire(g, 'orbital');
    advance(g, 0.94);
    expect(g.state.tanks[1].hp).toBe(36);
    expect(g.state.events.filter((e) => e.type === 'strike')).toHaveLength(2);
  });
  it('frost pulses damage and slow nearby enemies, respect shields, and clear after respawn', () => {
    const g = fixture(3);
    Object.assign(g.state.tanks[0], { x: 0, z: 0 });
    Object.assign(g.state.tanks[1], { x: 3, z: 0 });
    Object.assign(g.state.tanks[2], { x: 4, z: 0, shieldUntil: 100 });
    g.applyPickup(g.state.tanks[0], 'frost');
    const t = g.state.tanks[1];
    expect(t.hp).toBe(82);
    expect(g.state.tanks[2].hp).toBe(100);
    g.inputs.set(t.id, { ...EMPTY_INPUT, z: 1 });
    advance(g, 1);
    expect(t.z).toBeCloseTo(3.5);
    g.inputs.clear();
    g.hurt(t, 100, 'p0');
    advance(g, 3.1);
    expect(t.alive).toBe(true);
    expect(t.slowUntil).toBe(0);
  });
  it('all sixteen supply types are reachable through the refresh pool', () => {
    for (let i = 0; i < PICKUP_TYPES.length; i++) {
      const g = fixture(2, () => (i + 0.1) / PICKUP_TYPES.length);
      g.state.pickups = [{ id: 1, x: 20, z: 20, kind: 'shield', active: false, respawnAt: 0 }];
      g.step(1 / 30);
      expect(g.state.pickups[0].kind).toBe(PICKUP_TYPES[i]);
    }
    expect(PICKUP_TYPES).toHaveLength(16);
  });
  it('continuous special attacks respect the global and per-player field budgets', () => {
    const g = fixture(8);
    for (const t of g.state.tanks) {
      t.invulnerableUntil = 100;
      g.applyPickup(t, 'gravity');
      g.inputs.set(t.id, { ...EMPTY_INPUT, angle: 0, fire: true });
    }
    for (let i = 0; i < 180; i++) {
      g.step(1 / 30);
      expect(g.state.fields.length).toBeLessThanOrEqual(8);
      for (const t of g.state.tanks)
        expect(g.state.fields.filter((f) => f.owner === t.id).length).toBeLessThanOrEqual(2);
    }
    g.inputs.clear();
    advance(g, 5);
    expect(g.state.fields).toHaveLength(0);
  });
});
