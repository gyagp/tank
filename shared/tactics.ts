import { TEAMS, type GameState, type RoomPlayer, type Tank, type Vec2 } from './types';

export function balanceTeams(players: RoomPlayer[]) {
  players.forEach((p, i) => {
    p.team = i % 2 ? 'tide' : 'ember';
    p.color = Number.parseInt(TEAMS[p.team].color.slice(1), 16);
  });
}

export function allies(state: GameState, a: Tank | undefined, b: Tank | undefined) {
  return (
    !!a && !!b && (a.id === b.id || (state.mode === 'control' && !!a.team && a.team === b.team))
  );
}

/** Segment / expanded AABB intersection, without allocating sampled ray points. */
export function clearSight(state: GameState, a: Vec2, b: Vec2, pierceCrates = false) {
  for (const o of state.obstacles) {
    if (pierceCrates && o.hp >= 0) continue;
    let near = 0,
      far = 1;
    for (const axis of ['x', 'z'] as const) {
      const d = b[axis] - a[axis],
        half = (axis === 'x' ? o.w : o.d) / 2 + 0.1;
      const low = o[axis] - half,
        high = o[axis] + half;
      if (Math.abs(d) < 1e-8) {
        if (a[axis] < low || a[axis] > high) {
          near = 2;
          break;
        }
      } else {
        const t1 = (low - a[axis]) / d,
          t2 = (high - a[axis]) / d;
        near = Math.max(near, Math.min(t1, t2));
        far = Math.min(far, Math.max(t1, t2));
      }
    }
    if (near <= far) return false;
  }
  return true;
}

/** Smoke affects spotting, never physical projectiles. Recon is shared by teammates. */
export function canSpot(state: GameState, observer: Tank, target: Tank) {
  if (!target.alive) return false;
  if (allies(state, observer, target)) return true;
  if (!observer.alive) return false;
  if (
    Math.hypot(observer.x - target.x, observer.z - target.z) <= 2.5 ||
    target.revealedUntil > state.time
  )
    return true;
  if (
    state.tanks.some(
      (t) =>
        t.alive &&
        allies(state, observer, t) &&
        t.radarUntil > state.time &&
        Math.hypot(t.x - target.x, t.z - target.z) <= 18,
    )
  )
    return true;
  const dx = target.x - observer.x,
    dz = target.z - observer.z,
    length = dx * dx + dz * dz;
  return !state.fields.some((f) => {
    if (f.kind !== 'smoke' || f.expiresAt <= state.time) return false;
    const u = Math.max(
      0,
      Math.min(1, ((f.x - observer.x) * dx + (f.z - observer.z) * dz) / (length || 1)),
    );
    return Math.hypot(f.x - observer.x - u * dx, f.z - observer.z - u * dz) < f.radius;
  });
}

export function visibleTanks(state: GameState, playerId: string) {
  const observer = state.tanks.find((t) => t.id === playerId);
  return new Set(
    state.tanks.filter((t) => observer && canSpot(state, observer, t)).map((t) => t.id),
  );
}
