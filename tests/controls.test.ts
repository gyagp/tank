import { describe, expect, it } from 'vitest';
import { BattleControls, findAssistTarget } from '../src/game/controls';
import { Arena } from '../shared/engine';
import { EMPTY_INPUT } from '../shared/types';

describe('independent keyboard, mouse and touch controls', () => {
  it('releasing one movement key preserves the other direction', () => {
    const c = new BattleControls();
    c.keyDown('KeyW');
    c.keyDown('KeyD');
    expect(c.state).toMatchObject({ x: 1, z: -1 });
    c.keyUp('KeyD');
    expect(c.state).toMatchObject({ x: 0, z: -1 });
    c.keyDown('KeyS');
    expect(c.state.z).toBe(0);
  });
  it('releasing the mouse does not cancel spacebar fire, or vice versa', () => {
    const c = new BattleControls();
    c.keyDown('Space');
    c.mouseButton(0, true);
    c.mouseButton(0, false);
    expect(c.state.fire).toBe(true);
    c.mouseButton(0, true);
    c.keyUp('Space');
    expect(c.state.fire).toBe(true);
    c.mouseButton(0, false);
    expect(c.state.fire).toBe(false);
  });
  it('touch movement has a deadzone and releasing movement preserves right-stick fire', () => {
    const c = new BattleControls();
    c.moveTouch(0.04, -0.05);
    expect(c.state).toMatchObject({ x: 0, z: 0 });
    c.moveTouch(0.7, 0.3);
    c.aimTouch(1, true);
    c.moveTouch(0, 0);
    expect(c.state.fire).toBe(true);
    expect(c.state.angle).toBe(1);
    c.mouseButton(0, false);
    expect(c.state.fire).toBe(true);
    c.stopTouchAim();
    expect(c.state.fire).toBe(false);
  });
  it('preserves brief mine and right-click dash presses until one packet consumes them', () => {
    const c = new BattleControls();
    c.keyDown('KeyE');
    c.keyUp('KeyE');
    c.mouseButton(2, true);
    c.mouseButton(2, false);
    expect(c.packet()).toMatchObject({ mine: true, dash: true });
    expect(c.packet()).toMatchObject({ mine: false, dash: false });
  });
  it('losing focus clears held controls and queued abilities', () => {
    const c = new BattleControls();
    c.keyDown('KeyD');
    c.keyDown('Space');
    c.ability('mine', true);
    c.mouseButton(2, true);
    c.aimTouch(0.5, true);
    c.reset();
    expect(c.packet()).toEqual({ ...EMPTY_INPUT, angle: 0.5 });
  });
  it('manual firing takes priority over keyboard aim assistance', () => {
    const c = new BattleControls();
    c.keyDown('Space');
    expect(c.assistFire).toBe(true);
    c.mouseButton(0, true);
    expect(c.assistFire).toBe(false);
    c.mouseButton(0, false);
    expect(c.assistFire).toBe(true);
    c.aimTouch(1, true);
    expect(c.assistFire).toBe(false);
  });
});

function scene() {
  const game = new Arena(
    ['a', 'b', 'c'].map((id, i) => ({
      id,
      name: id,
      bot: false,
      classId: 'vanguard' as const,
      color: i,
    })),
    { map: 'desert', difficulty: 'normal', goal: 12, duration: 180 },
  );
  game.state.time = 3;
  game.state.obstacles = [];
  Object.assign(game.state.tanks[0], { x: 0, z: 0 });
  Object.assign(game.state.tanks[1], { x: 4, z: 0 });
  Object.assign(game.state.tanks[2], { x: 2, z: 4 });
  return game;
}
describe('assisted target selection', () => {
  it('chooses the closest unblocked enemy, skipping cover', () => {
    const g = scene();
    expect(findAssistTarget(g.state, 'a')?.id).toBe('b');
    g.state.obstacles = [{ id: 1, x: 2, z: 0, w: 1, d: 2, h: 2, hp: -1, kind: 'wall' }];
    expect(findAssistTarget(g.state, 'a')?.id).toBe('c');
  });
  it('skips shields, spawn protection and dead tanks', () => {
    const g = scene();
    g.state.tanks[1].shieldUntil = 10;
    g.state.tanks[2].invulnerableUntil = 10;
    expect(findAssistTarget(g.state, 'a')).toBeUndefined();
    g.state.tanks[1].shieldUntil = 0;
    g.state.tanks[1].alive = false;
    expect(findAssistTarget(g.state, 'a')).toBeUndefined();
  });
  it('respects weapon range and permits orbital targeting across cover', () => {
    const g = scene();
    g.state.tanks[2].alive = false;
    g.state.tanks[1].x = 10;
    g.state.tanks[0].weapon = 'flame';
    expect(findAssistTarget(g.state, 'a')).toBeUndefined();
    g.state.tanks[0].weapon = 'orbital';
    g.state.obstacles = [{ id: 1, x: 2, z: 0, w: 1, d: 5, h: 2, hp: -1, kind: 'wall' }];
    expect(findAssistTarget(g.state, 'a')?.id).toBe('b');
  });
});
