import { moveTank } from '../../shared/movement';
import type { InputState, Obstacle, Tank, Vec2 } from '../../shared/types';

/** Visual-only anticipation; the next authoritative snapshot always replaces the base. */
export function predictLocalPosition(
  out: Vec2,
  tank: Tank,
  input: InputState,
  age: number,
  time: number,
  obstacles: Obstacle[],
) {
  out.x = tank.x;
  out.z = tank.z;
  if (!tank.alive || age > 0.25) return out;
  moveTank(out, tank, input, time, Math.min(Math.max(0, age) + 1 / 60, 0.1), obstacles);
  return out;
}
