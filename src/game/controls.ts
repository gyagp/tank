import { EMPTY_INPUT, type GameState, type InputState, type Tank } from '../../shared/types';
import { allies, canSpot, clearSight } from '../../shared/tactics';

/** Keep input sources independent so releasing one device cannot cancel another. */
export class BattleControls {
  readonly state: InputState = { ...EMPTY_INPUT };
  private keys = new Set<string>();
  private mouseFire = false;
  private mouseDash = false;
  private touchFire = false;
  private touchX = 0;
  private touchZ = 0;
  private touchDash = false;
  private touchMine = false;
  private touchSmoke = false;
  private touchRadar = false;
  private queued = { dash: false, mine: false, smoke: false, radar: false };
  pointer: { x: number; y: number } | null = null;
  private aimSource: 'mouse' | 'touch' = 'mouse';
  get assistFire() {
    return this.keys.has('Space') && !this.mouseFire && !this.touchFire;
  }
  get pointerAim() {
    return this.aimSource === 'mouse' ? this.pointer : null;
  }
  private refresh() {
    const x =
      Number(this.keys.has('KeyD') || this.keys.has('ArrowRight')) -
      Number(this.keys.has('KeyA') || this.keys.has('ArrowLeft'));
    const z =
      Number(this.keys.has('KeyS') || this.keys.has('ArrowDown')) -
      Number(this.keys.has('KeyW') || this.keys.has('ArrowUp'));
    this.state.x = x || this.touchX;
    this.state.z = z || this.touchZ;
    this.state.fire = this.keys.has('Space') || this.mouseFire || this.touchFire;
    this.state.dash =
      this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.mouseDash || this.touchDash;
    this.state.mine = this.keys.has('KeyE') || this.touchMine;
    this.state.smoke = this.keys.has('KeyF') || this.touchSmoke;
    this.state.radar = this.keys.has('KeyG') || this.touchRadar;
  }
  keyDown(code: string) {
    this.keys.add(code);
    if (code === 'KeyF') this.queued.smoke = true;
    if (code === 'KeyG') this.queued.radar = true;
    if (code === 'KeyE') this.queued.mine = true;
    if (code === 'ShiftLeft' || code === 'ShiftRight') this.queued.dash = true;
    this.refresh();
  }
  keyUp(code: string) {
    this.keys.delete(code);
    this.refresh();
  }
  movePointer(x: number, y: number) {
    this.pointer = { x, y };
    this.aimSource = 'mouse';
  }
  mouseButton(button: number, down: boolean) {
    if (button === 0) this.mouseFire = down;
    if (button === 2) {
      this.mouseDash = down;
      if (down) this.queued.dash = true;
    }
    this.refresh();
  }
  moveTouch(x: number, z: number) {
    const centered = Math.hypot(x, z) < 0.15;
    this.touchX = centered ? 0 : x;
    this.touchZ = centered ? 0 : z;
    this.refresh();
  }
  aimTouch(angle: number, fire: boolean) {
    this.aimSource = 'touch';
    this.state.angle = angle;
    this.touchFire = fire;
    this.refresh();
  }
  stopTouchAim() {
    this.touchFire = false;
    this.refresh();
  }
  ability(kind: 'dash' | 'mine' | 'smoke' | 'radar', down: boolean) {
    if (kind === 'dash') this.touchDash = down;
    else if (kind === 'mine') this.touchMine = down;
    else if (kind === 'smoke') this.touchSmoke = down;
    else this.touchRadar = down;
    if (down) this.queued[kind] = true;
    this.refresh();
  }
  packet(): InputState {
    const result = {
      ...this.state,
      dash: this.state.dash || this.queued.dash,
      mine: this.state.mine || this.queued.mine,
      smoke: !!this.state.smoke || this.queued.smoke,
      radar: !!this.state.radar || this.queued.radar,
    };
    this.queued.dash = this.queued.mine = this.queued.smoke = this.queued.radar = false;
    return result;
  }
  reset() {
    this.keys.clear();
    this.mouseFire = this.mouseDash = this.touchFire = false;
    this.touchDash = this.touchMine = this.touchSmoke = this.touchRadar = false;
    this.touchX = this.touchZ = 0;
    this.queued.dash = this.queued.mine = this.queued.smoke = this.queued.radar = false;
    this.refresh();
  }
}

/** Assist chooses a visible, vulnerable opponent; damage still belongs to the server. */
export function findAssistTarget(state: GameState, playerId: string): Tank | undefined {
  const me = state.tanks.find((t) => t.id === playerId);
  if (!me?.alive) return;
  const range =
    me.weapon === 'lightning'
      ? 16
      : me.weapon === 'flame'
        ? 7
        : me.weapon === 'orbital' || me.weapon === 'gravity'
          ? 18
          : 28;
  return state.tanks
    .filter(
      (t) =>
        !allies(state, me, t) &&
        canSpot(state, me, t) &&
        t.alive &&
        t.shieldUntil <= state.time &&
        t.invulnerableUntil <= state.time &&
        Math.hypot(t.x - me.x, t.z - me.z) <= range,
    )
    .sort((a, b) => Math.hypot(a.x - me.x, a.z - me.z) - Math.hypot(b.x - me.x, b.z - me.z))
    .find((t) => me.weapon === 'orbital' || clearSight(state, me, t, me.weapon === 'rail'));
}
