import {
  ARENA_SIZE,
  TANK_CLASSES,
  TANK_RADIUS,
  type InputState,
  type Obstacle,
  type Tank,
  type Vec2,
} from './types';

export function circleHitsBox(p: Vec2, radius: number, o: Obstacle): boolean {
  const x = Math.max(o.x - o.w / 2, Math.min(o.x + o.w / 2, p.x));
  const z = Math.max(o.z - o.d / 2, Math.min(o.z + o.d / 2, p.z));
  return (p.x - x) ** 2 + (p.z - z) ** 2 < radius * radius;
}

export function isBlocked(p: Vec2, obstacles: Obstacle[], radius = TANK_RADIUS): boolean {
  const edge = ARENA_SIZE / 2 - radius;
  return (
    Math.abs(p.x) > edge ||
    Math.abs(p.z) > edge ||
    obstacles.some((o) => circleHitsBox(p, radius, o))
  );
}

export function moveTank(
  position: Vec2,
  tank: Tank,
  input: InputState,
  time: number,
  dt: number,
  obstacles: Obstacle[],
) {
  const speed =
    TANK_CLASSES[tank.classId].speed *
    (tank.speedUntil > time ? 1.45 : 1) *
    (tank.dashUntil > time ? 3 : 1) *
    (tank.slowUntil > time ? 0.5 : 1);
  const length = Math.max(1, Math.hypot(input.x, input.z));
  const dx = (input.x / length) * speed * dt,
    dz = (input.z / length) * speed * dt;
  displace(position, dx, dz, obstacles);
}

export function displace(position: Vec2, dx: number, dz: number, obstacles: Obstacle[]) {
  if (!dx && !dz) return;
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.3));
  const next = { x: position.x, z: position.z };
  for (let i = 0; i < steps; i++) {
    next.x = position.x + dx / steps;
    next.z = position.z;
    if (!isBlocked(next, obstacles)) position.x = next.x;
    next.x = position.x;
    next.z = position.z + dz / steps;
    if (!isBlocked(next, obstacles)) position.z = next.z;
  }
}
