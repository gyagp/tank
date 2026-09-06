import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SimulationClock } from '../server/clock';
import { Arena } from '../shared/engine';
import { EMPTY_INPUT } from '../shared/types';
import { predictLocalPosition } from '../src/game/prediction';
import { batchRigidParts } from '../src/game/batching';
import { makeTank } from '../src/game/models';
import { AdaptiveQuality } from '../src/game/quality';

function fixture() {
  return new Arena([{ id: 'a', name: 'A', color: 0xef6a3b, classId: 'vanguard', bot: false }], {
    map: 'desert',
    difficulty: 'normal',
    goal: 12,
    duration: 180,
  });
}

describe('simulation remains real-time under delayed timers', () => {
  it('a delayed 200ms callback advances six simulation steps and the correct distance', () => {
    const clock = new SimulationClock(0),
      game = fixture();
    game.state.obstacles = [];
    game.state.pickups = [];
    game.inputs.set('a', { ...EMPTY_INPUT, x: 1 });
    expect(clock.advance(200, (dt) => game.step(dt))).toBe(6);
    expect(game.state.time).toBeCloseTo(0.2);
    expect(game.state.tanks[0].x + 19).toBeCloseTo(1.4);
  });
  it('jittered callbacks maintain one second of game time, with bounded work after suspension', () => {
    const clock = new SimulationClock(0);
    let time = 0;
    for (const now of [20, 81, 133, 220, 275, 343, 401, 478, 550, 620, 733, 800, 900, 1000])
      clock.advance(now, (dt) => {
        time += dt;
      });
    expect(time).toBeCloseTo(1);
    expect(clock.advance(60000, () => {})).toBeLessThanOrEqual(8);
  });
});

describe('responsive visual prediction respects authoritative collision and position', () => {
  it('responds before the next network snapshot without mutating the server state', () => {
    const game = fixture(),
      tank = game.state.tanks[0],
      out = { x: 0, z: 0 };
    predictLocalPosition(out, tank, { ...EMPTY_INPUT, x: 1 }, 0, 0, []);
    expect(out.x).toBeGreaterThan(tank.x);
    expect(tank.x).toBe(-19);
    tank.x = -10;
    predictLocalPosition(out, tank, EMPTY_INPUT, 0, 0, []);
    expect(out.x).toBe(-10);
  });
  it('stops at walls and disables anticipation for stale snapshots and destroyed vehicles', () => {
    const game = fixture(),
      tank = game.state.tanks[0],
      out = { x: 0, z: 0 },
      input = { ...EMPTY_INPUT, x: 1 };
    tank.x = -1.4;
    tank.z = 0;
    const wall = { id: 1, x: 0, z: 0, w: 1, d: 8, h: 2, hp: -1, kind: 'wall' as const };
    predictLocalPosition(out, tank, input, 0.1, 0, [wall]);
    expect(out.x).toBeLessThanOrEqual(-1.28);
    predictLocalPosition(out, tank, input, 0.3, 0, []);
    expect(out.x).toBe(tank.x);
    tank.alive = false;
    predictLocalPosition(out, tank, input, 0.1, 0, []);
    expect(out.x).toBe(tank.x);
  });
});

describe('render batching retains geometry and materials', () => {
  it('preserves world bounds through nested transforms and independent root animation', () => {
    const parent = new THREE.Group(),
      root = new THREE.Group(),
      nested = new THREE.Group();
    parent.position.set(10, 2, -5);
    root.rotation.y = 0.4;
    nested.position.set(2, 0, 1);
    parent.add(root);
    root.add(nested);
    const material = new THREE.MeshStandardMaterial({ color: 0x788166 });
    for (let i = 0; i < 8; i++) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), material);
      mesh.position.set(i * 0.2, 0, i);
      nested.add(mesh);
    }
    parent.updateWorldMatrix(true, true);
    const before = new THREE.Box3().setFromObject(root, true);
    batchRigidParts(root);
    const after = new THREE.Box3().setFromObject(root, true);
    expect(before.min.distanceTo(after.min)).toBeLessThan(0.00001);
    expect(before.max.distanceTo(after.max)).toBeLessThan(0.00001);
    let draws = 0;
    root.traverse((o) => {
      if (o instanceof THREE.Mesh) draws++;
    });
    expect(draws).toBe(1);
    root.position.x += 3;
    const moved = new THREE.Box3().setFromObject(root, true);
    expect(moved.min.x - after.min.x).toBeCloseTo(3);
  });
  it('keeps turret rotation independent and the authored tank silhouette intact', () => {
    const tank = makeTank('vanguard', 0xef6a3b);
    const before = new THREE.Box3().setFromObject(tank.chassis);
    tank.turret.rotation.y = Math.PI / 2;
    const after = new THREE.Box3().setFromObject(tank.chassis);
    expect(before.equals(after)).toBe(true);
    let meshes = 0;
    tank.root.traverse((o) => {
      if (o instanceof THREE.Mesh) meshes++;
    });
    expect(meshes).toBeLessThan(25);
    expect(before.getSize(new THREE.Vector3()).z).toBeGreaterThan(2);
  });
  it('adaptive resolution reacts to sustained slow frames and stays within its limits', () => {
    const quality = new AdaptiveQuality(1.5);
    for (let i = 0; i < 1000; i++) quality.sample(0.04);
    expect(quality.scale).toBe(0.65);
    const scale = quality.scale;
    quality.sample(5);
    expect(quality.scale).toBe(scale);
    for (let i = 0; i < 6000; i++) quality.sample(1 / 60);
    expect(quality.scale).toBe(1.5);
  });
  it('also reduces quality for software rendering below four frames per second', () => {
    const quality = new AdaptiveQuality(1);
    for (let i = 0; i < 10; i++) quality.sample(0.5);
    expect(quality.scale).toBeLessThan(1);
  });
});
