import { describe, expect, it } from 'vitest';
import { Arena, cleanInput } from '../shared/engine';
import {
  COLORS,
  EMPTY_INPUT,
  PICKUPS,
  type InputState,
  type MapId,
  type PickupKind,
  type RoomPlayer,
  type TankClass,
} from '../shared/types';
import { SPAWNS, SUPPLY_POINTS } from '../shared/maps';

const player = (id: string, bot = false, classId: TankClass = 'vanguard'): RoomPlayer => ({
  id,
  name: id,
  bot,
  classId,
  color: COLORS[id === 'a' ? 0 : 1],
});
function arena(players = [player('a'), player('b')]) {
  const game = new Arena(
    players,
    { map: 'desert', difficulty: 'normal', goal: 12, duration: 180 },
    () => 0.4,
  );
  game.state.obstacles = [];
  game.state.pickups = [];
  game.state.time = 3;
  game.state.tanks.forEach((t, i) =>
    Object.assign(t, { x: -10 + i * 10, z: 0, invulnerableUntil: 0 }),
  );
  return game;
}
const advance = (game: Arena, seconds: number) => {
  for (let i = 0; i < seconds * 30; i++) game.step(1 / 30);
};
const input = (patch: Partial<InputState>): InputState => ({ ...EMPTY_INPUT, ...patch });

describe('authoritative movement', () => {
  it('preserves a brief mine press even if a release packet arrives before the next simulation tick', () => {
    const g = arena();
    g.setInput('a', input({ mine: true }));
    g.setInput('a', input({ mine: false }));
    g.step(1 / 30);
    expect(g.state.mines).toHaveLength(1);
    g.step(1 / 30);
    expect(g.state.mines).toHaveLength(1);
  });
  it('normalizes diagonal movement and applies class speed', () => {
    const g = arena();
    const t = g.state.tanks[0];
    g.inputs.set('a', input({ x: 1, z: 1 }));
    advance(g, 1);
    expect(Math.hypot(t.x + 10, t.z)).toBeCloseTo(7, 4);
  });
  it('slides along solid cover and cannot dash through it', () => {
    const g = arena();
    const t = g.state.tanks[0];
    t.x = -2.5;
    g.state.obstacles = [{ id: 1, x: 0, z: 0, w: 1, d: 8, h: 2, hp: -1, kind: 'wall' }];
    g.inputs.set('a', input({ x: 1, z: 0.2, dash: true }));
    advance(g, 0.3);
    expect(t.x).toBeLessThan(-1.25);
    expect(t.z).toBeGreaterThan(0.4);
    expect(g.blocked(t)).toBe(false);
  });
  it('enforces arena boundaries', () => {
    const g = arena();
    g.inputs.set('a', input({ x: -1, z: -1, dash: true }));
    advance(g, 30);
    const t = g.state.tanks[0];
    expect(t.x).toBeGreaterThanOrEqual(-23.22);
    expect(t.z).toBeGreaterThanOrEqual(-23.22);
  });
  it('does not refresh dash before its cooldown', () => {
    const g = arena();
    g.inputs.set('a', input({ x: 1, dash: true }));
    advance(g, 1);
    expect(g.state.events.filter((e) => e.type === 'dash')).toHaveLength(1);
    expect(g.state.tanks[0].dashReadyAt).toBeGreaterThan(6.9);
  });
  it('rejects non-finite, excessive and incorrectly typed network inputs', () => {
    expect(cleanInput(null)).toEqual(EMPTY_INPUT);
    expect(cleanInput({ x: Infinity, z: NaN, angle: 'hi', fire: 1, dash: 'yes' })).toEqual(
      EMPTY_INPUT,
    );
    expect(cleanInput({ x: 500, z: -500, angle: 50, fire: true }).x).toBe(1);
    expect(cleanInput({ x: 500, z: -500, angle: 50, fire: true }).z).toBe(-1);
    expect(cleanInput({ angle: 50 }).angle).toBeLessThanOrEqual(2 * Math.PI);
  });
});

describe('combat, equipment and scoring', () => {
  it('fires real projectiles, deals damage, awards one kill and respawns safely', () => {
    const g = arena(),
      victim = g.state.tanks[1];
    g.inputs.set('a', input({ angle: Math.PI / 2, fire: true }));
    advance(g, 2.2);
    expect(victim.alive).toBe(false);
    expect(victim.deaths).toBe(1);
    expect(g.state.tanks[0].kills).toBe(1);
    g.inputs.clear();
    advance(g, 3.2);
    expect(victim.alive).toBe(true);
    expect(victim.hp).toBe(victim.maxHp);
    expect(victim.invulnerableUntil).toBeGreaterThan(g.state.time);
  });
  it('respects spawn protection and an energy shield', () => {
    const g = arena(),
      t = g.state.tanks[1];
    t.invulnerableUntil = g.state.time + 2;
    g.hurt(t, 50, 'a');
    expect(t.hp).toBe(100);
    t.invulnerableUntil = 0;
    g.applyPickup(t, 'shield');
    g.hurt(t, 200, 'a');
    expect(t.hp).toBe(100);
    advance(g, 7.1);
    g.hurt(t, 25, 'a');
    expect(t.hp).toBe(75);
  });
  it('does not award a kill for self-inflicted damage', () => {
    const g = arena(),
      t = g.state.tanks[0];
    g.hurt(t, 100, 'a');
    expect(t.deaths).toBe(1);
    expect(t.kills).toBe(0);
  });
  it('solid walls stop a shell, while destructible cover takes damage', () => {
    const g = arena();
    g.state.obstacles = [{ id: 1, x: -5, z: 0, w: 2, d: 3, h: 2, hp: -1, kind: 'wall' }];
    g.inputs.set('a', input({ angle: Math.PI / 2, fire: true }));
    advance(g, 1.5);
    expect(g.state.tanks[1].hp).toBe(100);
    expect(g.state.obstacles[0].hp).toBe(-1);
    g.state.obstacles[0].kind = 'crate';
    g.state.obstacles[0].hp = 50;
    advance(g, 2);
    expect(g.state.obstacles).toHaveLength(0);
    expect(g.state.tanks[1].hp).toBeLessThan(100);
  });
  it('railgun pierces cover and deals damage only once to each object', () => {
    const g = arena();
    g.applyPickup(g.state.tanks[0], 'rail');
    g.state.obstacles = [{ id: 99, x: -5, z: 0, w: 3, d: 2, h: 2, hp: 100, kind: 'crate' }];
    g.inputs.set('a', input({ angle: Math.PI / 2, fire: true }));
    g.step(1 / 30);
    g.inputs.clear();
    advance(g, 0.3);
    expect(g.state.obstacles[0].hp).toBe(48);
    expect(g.state.tanks[1].hp).toBe(48);
  });
  it('scatter fires three shells and rapid fire has a shorter cadence', () => {
    const scatter = arena();
    scatter.applyPickup(scatter.state.tanks[0], 'scatter');
    scatter.inputs.set('a', input({ fire: true }));
    scatter.step(1 / 30);
    expect(scatter.state.bullets).toHaveLength(3);
    const rapid = arena();
    rapid.applyPickup(rapid.state.tanks[0], 'rapid');
    rapid.inputs.set('a', input({ fire: true }));
    advance(rapid, 0.5);
    expect(rapid.state.events.filter((e) => e.type === 'shot').length).toBeGreaterThanOrEqual(4);
  });
  it('homing missiles steer toward an enemy and flame has limited range', () => {
    const g = arena();
    g.applyPickup(g.state.tanks[0], 'homing');
    g.state.tanks[1].z = 5;
    g.inputs.set('a', input({ angle: Math.PI / 2, fire: true }));
    g.step(1 / 30);
    g.inputs.clear();
    advance(g, 0.2);
    expect(g.state.bullets[0].vz).toBeGreaterThan(0);
    const flame = arena();
    flame.applyPickup(flame.state.tanks[0], 'flame');
    flame.inputs.set('a', input({ angle: Math.PI / 2, fire: true }));
    advance(flame, 1.5);
    expect(flame.state.tanks[1].hp).toBe(100);
  });
  it('expires special weapons, caps repairs and mine inventory, and doubles damage', () => {
    const g = arena(),
      t = g.state.tanks[0];
    g.applyPickup(t, 'scatter');
    advance(g, 12.1);
    expect(t.weapon).toBe('standard');
    t.hp = 80;
    g.applyPickup(t, 'repair');
    expect(t.hp).toBe(100);
    g.applyPickup(t, 'mines');
    g.applyPickup(t, 'mines');
    expect(t.mines).toBe(3);
    g.applyPickup(t, 'damage');
    g.inputs.set('a', input({ angle: Math.PI / 2, fire: true }));
    g.step(1 / 30);
    expect(g.state.bullets[0].damage).toBe(50);
  });
  it('speed buff increases actual movement speed', () => {
    const g = arena(),
      t = g.state.tanks[0];
    g.applyPickup(t, 'speed');
    g.inputs.set('a', input({ z: 1 }));
    advance(g, 1);
    expect(t.z).toBeCloseTo(7 * 1.45, 4);
  });
  it('picks up a supply once and respawns it after its timer', () => {
    const g = arena();
    g.state.pickups = [{ id: 1, x: -10, z: 0, kind: 'shield', active: true, respawnAt: 0 }];
    g.step(1 / 30);
    expect(g.state.pickups[0].active).toBe(false);
    expect(g.state.tanks[0].shieldUntil).toBeGreaterThan(9);
    g.state.tanks[0].x = -20;
    advance(g, 15);
    expect(g.state.pickups[0].active).toBe(true);
  });
  it('arms mines after a delay, triggers on enemies and removes the mine', () => {
    const g = arena();
    g.inputs.set('a', input({ mine: true }));
    g.step(1 / 30);
    g.inputs.clear();
    expect(g.state.mines).toHaveLength(1);
    expect(g.state.tanks[0].mines).toBe(1);
    g.state.tanks[1].x = -10;
    g.state.tanks[0].x = -18;
    advance(g, 0.3);
    expect(g.state.tanks[1].hp).toBe(100);
    advance(g, 0.6);
    expect(g.state.tanks[1].hp).toBe(32);
    expect(g.state.mines).toHaveLength(0);
  });
  it('barrel explosions damage nearby vehicles', () => {
    const g = arena();
    g.state.tanks[1].x = -3;
    g.state.tanks[1].z = 2;
    g.state.obstacles = [{ id: 7, x: -3, z: 0, w: 1, d: 1, h: 1.4, hp: 24, kind: 'barrel' }];
    g.inputs.set('a', input({ angle: Math.PI / 2, fire: true }));
    advance(g, 0.4);
    expect(g.state.obstacles).toHaveLength(0);
    expect(g.state.tanks[1].hp).toBeLessThan(100);
  });
  it('ends at the score limit and freezes the completed match', () => {
    const g = arena();
    g.state.goal = 1;
    g.hurt(g.state.tanks[1], 100, 'a');
    g.step(1 / 30);
    expect(g.state.status).toBe('finished');
    expect(g.state.winner).toBe('a');
    const time = g.state.time;
    advance(g, 10);
    expect(g.state.time).toBe(time);
  });
  it('time limit uses kills then fewer deaths and permits a true draw', () => {
    const g = arena();
    g.state.time = 180;
    g.state.tanks[0].deaths = 1;
    g.step(1 / 30);
    expect(g.state.winner).toBe('b');
    const tie = arena();
    tie.state.time = 180;
    tie.step(1 / 30);
    expect(tie.state.winner).toBeNull();
  });
});

describe('maps and computer opponents', () => {
  for (const map of ['desert', 'arctic', 'forest'] as MapId[])
    it(`${map}: all spawns and supply points are accessible`, () => {
      const game = new Arena([player('a'), player('b')], {
        map,
        difficulty: 'normal',
        goal: 12,
        duration: 180,
      });
      for (const point of [...SPAWNS, ...SUPPLY_POINTS])
        expect(game.blocked(point), JSON.stringify(point)).toBe(false);
    });
  it('AI navigates around cover, engages enemies and produces combat outcomes', () => {
    const game = new Arena(
      [
        player('a', true),
        player('b', true),
        player('c', true, 'ghost'),
        player('d', true, 'bastion'),
      ],
      { map: 'desert', difficulty: 'hard', goal: 20, duration: 180 },
      () => 0.35,
    );
    const starts = game.state.tanks.map((t) => ({ x: t.x, z: t.z }));
    let moved = false;
    for (let i = 0; i < 30 * 75; i++) {
      game.step(1 / 30);
      if (i === 150)
        moved = game.state.tanks.every(
          (t, j) => Math.hypot(t.x - starts[j].x, t.z - starts[j].z) > 3,
        );
      for (const t of game.state.tanks) if (t.alive) expect(game.blocked(t)).toBe(false);
    }
    expect(moved).toBe(true);
    expect(game.state.tanks.reduce((n, t) => n + t.kills, 0)).toBeGreaterThan(3);
  });
  it('every documented pickup kind applies without corrupting tank state', () => {
    const g = arena();
    for (const kind of Object.keys(PICKUPS) as PickupKind[]) g.applyPickup(g.state.tanks[0], kind);
    expect(Number.isFinite(g.state.tanks[0].hp)).toBe(true);
    expect(g.state.events.filter((e) => e.type === 'pickup')).toHaveLength(
      Object.keys(PICKUPS).length,
    );
  });
});
