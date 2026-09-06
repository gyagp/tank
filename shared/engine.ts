import {
  ARENA_SIZE,
  CONTROL_GOAL,
  TEAMS,
  type Team,
  EMPTY_INPUT,
  PICKUPS,
  PICKUP_TYPES,
  WEAPON_PICKUPS,
  OPENING_SUPPLIES,
  TANK_CLASSES,
  TANK_RADIUS,
  type Bullet,
  type GameEvent,
  type GameState,
  type InputState,
  type Obstacle,
  type PickupKind,
  type RoomPlayer,
  type RoomSettings,
  type Tank,
  type Vec2,
  type Weapon,
  type Field,
} from './types';
import { makeMap, SPAWNS, SUPPLY_POINTS } from './maps';
import { circleHitsBox, isBlocked, moveTank, displace } from './movement';
import { allies, canSpot, clearSight } from './tactics';
export { circleHitsBox } from './movement';

const distance = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z);
const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));
export function cleanInput(input: unknown): InputState {
  if (!input || typeof input !== 'object') return { ...EMPTY_INPUT };
  const value = input as Record<string, unknown>;
  const num = (k: string, min: number, max: number) =>
    typeof value[k] === 'number' && Number.isFinite(value[k])
      ? clamp(value[k] as number, min, max)
      : 0;
  return {
    x: num('x', -1, 1),
    z: num('z', -1, 1),
    angle: num('angle', -Math.PI * 2, Math.PI * 2),
    fire: value.fire === true,
    dash: value.dash === true,
    mine: value.mine === true,
    smoke: value.smoke === true,
    radar: value.radar === true,
  };
}

export class Arena {
  state: GameState;
  inputs = new Map<string, InputState>();
  private serial = 0;
  private paths = new Map<string, { until: number; nodes: Vec2[] }>();
  private bulletHits = new Map<number, Set<string>>();
  private queuedActions = new Map<
    string,
    { mine: boolean; dash: boolean; smoke: boolean; radar: boolean }
  >();
  constructor(
    players: RoomPlayer[],
    public settings: RoomSettings,
    private random: () => number = Math.random,
  ) {
    this.state = {
      mode: settings.mode || 'deathmatch',
      controlPoints:
        settings.mode === 'control'
          ? (['A', 'B', 'C'] as const).map((id, i) => ({
              id,
              x: (i - 1) * 12,
              z: 0,
              radius: 3.4,
              owner: null,
              capturing: null,
              progress: 0,
              contested: false,
            }))
          : [],
      teamScores: { ember: 0, tide: 0 },
      winnerTeam: null,
      map: settings.map,
      time: 0,
      duration: settings.duration,
      goal: settings.mode === 'control' ? CONTROL_GOAL : settings.goal,
      status: 'playing',
      winner: null,
      tanks: [],
      bullets: [],
      mines: [],
      events: [],
      fields: [],
      obstacles: makeMap(settings.map),
      pickups: SUPPLY_POINTS.map((p, i) => ({
        ...p,
        id: i,
        support: i >= 16,
        kind: OPENING_SUPPLIES[i % OPENING_SUPPLIES.length],
        active: true,
        respawnAt: 0,
      })),
    };
    players.forEach((p, i) => {
      const team = settings.mode === 'control' ? p.team || (i % 2 ? 'tide' : 'ember') : undefined;
      const spawn = team ? this.teamSpawns(team)[Math.floor(i / 2) % 4] : SPAWNS[i % SPAWNS.length];
      this.state.tanks.push({
        ...p,
        ...spawn,
        team,
        color: team ? Number.parseInt(TEAMS[team].color.slice(1), 16) : p.color,
        captures: 0,
        smokeReadyAt: 0,
        radarReadyAt: 0,
        radarUntil: 0,
        revealedUntil: 0,
        angle: 0,
        bodyAngle: 0,
        hp: TANK_CLASSES[p.classId].hp,
        maxHp: TANK_CLASSES[p.classId].hp,
        kills: 0,
        deaths: 0,
        alive: true,
        respawnAt: 0,
        invulnerableUntil: 2.5,
        weapon: 'standard',
        weaponUntil: 0,
        shieldUntil: 0,
        speedUntil: 0,
        damageUntil: 0,
        slowUntil: 0,
        dashUntil: 0,
        dashReadyAt: 0,
        mines: 2,
        nextFire: 0,
        nextMine: 0,
      });
    });
  }
  private teamSpawns(team: Team) {
    return SPAWNS.filter((p) => (p.z < 0 || (p.z === 0 && p.x < 0)) === (team === 'ember'));
  }
  private friendly(owner: string, target: Tank) {
    return allies(
      this.state,
      this.state.tanks.find((t) => t.id === owner),
      target,
    );
  }
  event(type: GameEvent['type'], p: Vec2, extras: Partial<GameEvent> = {}) {
    this.state.events.push({ id: ++this.serial, type, x: p.x, z: p.z, ...extras });
    if (this.state.events.length > 100) this.state.events.splice(0, this.state.events.length - 100);
  }
  setInput(id: string, input: InputState) {
    const queued = this.queuedActions.get(id);
    this.queuedActions.set(id, {
      mine: input.mine || !!queued?.mine,
      dash: input.dash || !!queued?.dash,
      smoke: !!input.smoke || !!queued?.smoke,
      radar: !!input.radar || !!queued?.radar,
    });
    this.inputs.set(id, input);
  }
  blocked(p: Vec2, radius = TANK_RADIUS): boolean {
    return isBlocked(p, this.state.obstacles, radius);
  }
  lineClear(a: Vec2, b: Vec2): boolean {
    return clearSight(this.state, a, b);
  }
  private findPath(from: Vec2, to: Vec2): Vec2[] {
    const size = 24;
    const coord = (p: Vec2) => [
      clamp(Math.floor((p.x + 24) / 2), 0, 23),
      clamp(Math.floor((p.z + 24) / 2), 0, 23),
    ];
    const [sx, sz] = coord(from),
      [tx, tz] = coord(to);
    const start = sz * size + sx,
      end = tz * size + tx;
    const queue = [start],
      previous = new Map<number, number>([[start, -1]]);
    let closest = start,
      best = Infinity;
    for (let head = 0; head < queue.length; head++) {
      const current = queue[head],
        x = current % size,
        z = Math.floor(current / size);
      const gap = Math.hypot(tx - x, tz - z);
      if (gap < best) {
        best = gap;
        closest = current;
      }
      if (current === end) break;
      for (const [dx, dz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nx = x + dx,
          nz = z + dz,
          n = nz * size + nx;
        if (nx < 0 || nx >= size || nz < 0 || nz >= size || previous.has(n)) continue;
        if (this.blocked({ x: nx * 2 - 23, z: nz * 2 - 23 }, 0.9)) continue;
        previous.set(n, current);
        queue.push(n);
      }
    }
    const nodes: Vec2[] = [];
    for (let n = closest; n !== start && n !== -1; n = previous.get(n) ?? -1)
      nodes.unshift({ x: (n % size) * 2 - 23, z: Math.floor(n / size) * 2 - 23 });
    return nodes;
  }
  private ai(tank: Tank): InputState {
    const s = this.state;
    const enemy = s.tanks
      .filter((t) => t.alive && !allies(s, tank, t) && canSpot(s, tank, t))
      .sort((a, b) => distance(a, tank) - distance(b, tank))[0];
    const gap = enemy ? distance(tank, enemy) : Infinity;
    const clear = !!enemy && this.lineClear(tank, enemy);
    const teamIndex = s.tanks
      .filter((t) => t.team === tank.team)
      .findIndex((t) => t.id === tank.id);
    const objective = [...s.controlPoints].sort((a, b) => {
      const cost = (p: typeof a) =>
        distance(tank, p) +
        (p.owner === tank.team && !p.contested ? 28 : 0) +
        (p.id === s.controlPoints[teamIndex % 3]?.id ? -10 : 0);
      return cost(a) - cost(b);
    })[0];
    const supply = s.pickups
      .filter(
        (p) =>
          p.active &&
          (tank.hp < tank.maxHp * 0.45
            ? p.kind === 'repair'
            : tank.weapon === 'standard' && p.kind !== 'repair' && p.kind !== 'mines'),
      )
      .sort((a, b) => distance(a, tank) - distance(b, tank))[0];
    let target: Vec2 = objective || enemy || tank;
    if (supply && distance(tank, supply) < (tank.hp < tank.maxHp * 0.45 ? 24 : 5)) target = supply;
    const holding = target === objective && distance(tank, target) < objective.radius * 0.62;
    let dx = holding ? 0 : target.x - tank.x,
      dz = holding ? 0 : target.z - tank.z;
    if (
      !holding &&
      (!this.lineClear(tank, target) ||
        this.blocked({
          x: tank.x + (dx / (Math.hypot(dx, dz) || 1)) * 1.5,
          z: tank.z + (dz / (Math.hypot(dx, dz) || 1)) * 1.5,
        }))
    ) {
      let path = this.paths.get(tank.id);
      if (!path || path.until < s.time || !path.nodes.length) {
        path = { until: s.time + 1, nodes: this.findPath(tank, target) };
        this.paths.set(tank.id, path);
      }
      while (path.nodes.length && distance(tank, path.nodes[0]) < 0.8) path.nodes.shift();
      const node = path.nodes[0] || target;
      dx = node.x - tank.x;
      dz = node.z - tank.z;
    } else if (target === enemy && enemy && gap < 10 && clear) {
      const spin = Math.sin(s.time * 0.7 + tank.color) > 0 ? 1 : -1;
      dx = (tank.z - enemy.z) * spin;
      dz = (enemy.x - tank.x) * spin;
      if (gap < 5) {
        dx += (tank.x - enemy.x) * 2;
        dz += (tank.z - enemy.z) * 2;
      }
    }
    const len = Math.hypot(dx, dz) || 1;
    const lead = this.settings.difficulty === 'hard' && enemy ? gap / 25 : 0;
    const enemyInput = enemy && this.inputs.get(enemy.id);
    const error =
      this.settings.difficulty === 'easy'
        ? 0.25
        : this.settings.difficulty === 'normal'
          ? 0.1
          : 0.025;
    const angle = enemy
      ? Math.atan2(
          enemy.x - tank.x + (enemyInput?.x || 0) * 7 * lead,
          enemy.z - tank.z + (enemyInput?.z || 0) * 7 * lead,
        ) +
        Math.sin(s.time * 2 + tank.color) * error
      : tank.angle;
    return {
      x: dx / len,
      z: dz / len,
      angle,
      fire:
        clear && gap < 29 && (this.settings.difficulty !== 'easy' || Math.sin(s.time * 2) > -0.1),
      dash: !holding && distance(tank, target) > 10 && this.lineClear(tank, target),
      mine: gap < 5 || (holding && !!objective && objective.owner === tank.team && tank.mines > 1),
      smoke: tank.hp < tank.maxHp * 0.4 && gap < 13,
      radar:
        s.fields.some((f) => f.kind === 'smoke' && distance(f, tank) < 18) ||
        !!objective?.contested,
    };
  }
  private updateObjectives(dt: number) {
    const s = this.state;
    for (const p of s.controlPoints) {
      const present = s.tanks.filter((t) => t.alive && distance(t, p) < p.radius);
      const ember = present.filter((t) => t.team === 'ember').length;
      const tide = present.filter((t) => t.team === 'tide').length;
      p.contested = ember > 0 && tide > 0;
      const team: Team | null = ember ? 'ember' : tide ? 'tide' : null;
      if (!p.contested && team) {
        if (p.owner === team) {
          p.progress = 0;
          p.capturing = null;
        } else {
          if (p.capturing !== team) {
            p.progress = 0;
            p.capturing = team;
          }
          p.progress = Math.min(
            1,
            p.progress + (dt / 3) * Math.min(1.5, 1 + (present.length - 1) * 0.25),
          );
          if (p.progress >= 1 - 1e-8) {
            if (p.owner) p.owner = null;
            else {
              p.owner = team;
              for (const t of present) t.captures++;
              this.event('capture', p, { label: p.id, actor: present[0].id });
            }
            p.progress = 0;
            p.capturing = null;
          }
        }
      } else if (!team) {
        p.progress = Math.max(0, p.progress - dt / 6);
        if (!p.progress) p.capturing = null;
      }
      // An enemy entering the circle immediately interrupts this point's income.
      if (p.owner && !p.contested && (!team || team === p.owner)) s.teamScores[p.owner] += dt;
    }
    if (s.teamScores.ember >= s.goal || s.teamScores.tide >= s.goal || s.time >= s.duration) {
      s.status = 'finished';
      const difference = s.teamScores.ember - s.teamScores.tide;
      s.winnerTeam = Math.abs(difference) < 1e-6 ? null : difference > 0 ? 'ember' : 'tide';
    }
  }
  step(dt: number) {
    const s = this.state;
    if (s.status !== 'playing') return;
    dt = clamp(dt, 0, 0.1);
    s.time += dt;
    for (const tank of s.tanks) {
      if (!tank.alive) {
        this.queuedActions.delete(tank.id);
        if (s.time >= tank.respawnAt) this.respawn(tank);
        else continue;
      }
      const base = tank.bot ? this.ai(tank) : this.inputs.get(tank.id) || EMPTY_INPUT,
        queued = this.queuedActions.get(tank.id);
      const input = {
        ...base,
        mine: base.mine || !!queued?.mine,
        dash: base.dash || !!queued?.dash,
        smoke: base.smoke || !!queued?.smoke,
        radar: base.radar || !!queued?.radar,
      };
      this.queuedActions.delete(tank.id);
      tank.angle = input.angle;
      if (tank.weaponUntil <= s.time) tank.weapon = 'standard';
      if (input.dash && s.time >= tank.dashReadyAt && (input.x || input.z)) {
        tank.dashUntil = s.time + 0.24;
        tank.dashReadyAt = s.time + 4;
        this.event('dash', tank, { actor: tank.id });
      }
      if (input.x || input.z) tank.bodyAngle = Math.atan2(input.x, input.z);
      moveTank(tank, tank, input, s.time, dt, s.obstacles);
      if (input.smoke && s.time >= tank.smokeReadyAt) {
        tank.smokeReadyAt = s.time + 12;
        this.placeField('smoke', tank, tank.id);
        this.event('smoke', tank, { actor: tank.id, radius: 4.5 });
      }
      if (input.radar && s.time >= tank.radarReadyAt) {
        tank.radarReadyAt = s.time + 15;
        tank.radarUntil = s.time + 4;
        this.event('radar', tank, { actor: tank.id, radius: 18 });
      }
      if (input.fire && s.time >= tank.nextFire) this.fire(tank);
      if (input.mine && tank.mines > 0 && s.time >= tank.nextMine) {
        tank.mines--;
        tank.nextMine = s.time + 0.8;
        s.mines.push({
          id: ++this.serial,
          owner: tank.id,
          x: tank.x,
          z: tank.z,
          armedAt: s.time + 0.8,
          expireAt: s.time + 35,
        });
      }
      for (const p of s.pickups)
        if (
          p.active &&
          distance(tank, p) < 1.45 &&
          !(p.kind === 'repair' && tank.hp >= tank.maxHp) &&
          !(p.kind === 'mines' && tank.mines >= 3)
        ) {
          this.applyPickup(tank, p.kind);
          p.active = false;
          p.respawnAt = s.time + (p.support ? 4 : 5) + this.random();
        }
    }
    for (const bullet of s.bullets) this.updateBullet(bullet, dt);
    this.updateFields(dt);
    s.bullets = s.bullets.filter((b) => {
      if (b.life <= 0) {
        this.bulletHits.delete(b.id);
        return false;
      }
      return true;
    });
    for (const mine of [...s.mines]) {
      if (
        mine.armedAt <= s.time &&
        s.tanks.some((t) => t.alive && !this.friendly(mine.owner, t) && distance(t, mine) < 1.7)
      ) {
        mine.expireAt = 0;
        this.explode(mine, 4, 68, mine.owner);
      }
    }
    s.mines = s.mines.filter((m) => m.expireAt > s.time);
    for (const p of s.pickups)
      if (!p.active && p.respawnAt <= s.time) {
        p.active = true;
        if (!p.support)
          p.kind =
            PICKUP_TYPES[Math.floor(this.random() * PICKUP_TYPES.length) % PICKUP_TYPES.length];
      }
    if (s.mode === 'control') {
      this.updateObjectives(dt);
      return;
    }
    if (s.tanks.some((t) => t.kills >= s.goal) || s.time >= s.duration) {
      s.status = 'finished';
      const rank = [...s.tanks].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
      s.winner =
        rank[0] &&
        (!rank[1] || rank[0].kills !== rank[1].kills || rank[0].deaths !== rank[1].deaths)
          ? rank[0].id
          : null;
    }
  }
  private aimTarget(tank: Tank, range: number, cover = true): Tank | undefined {
    return this.state.tanks
      .filter(
        (t) =>
          t.alive &&
          !allies(this.state, tank, t) &&
          canSpot(this.state, tank, t) &&
          distance(t, tank) <= range &&
          Math.abs(
            Math.atan2(
              Math.sin(Math.atan2(t.x - tank.x, t.z - tank.z) - tank.angle),
              Math.cos(Math.atan2(t.x - tank.x, t.z - tank.z) - tank.angle),
            ),
          ) < 0.5 &&
          (!cover || this.lineClear(tank, t)),
      )
      .sort((a, b) => distance(a, tank) - distance(b, tank))[0];
  }
  private lightning(tank: Tank) {
    tank.nextFire = this.state.time + 0.62;
    let target = this.aimTarget(tank, 16),
      from: Vec2 = tank;
    const hit = new Set<string>([tank.id]);
    if (!target) {
      let end = { x: tank.x, z: tank.z };
      for (let d = 1; d <= 14; d += 0.4) {
        const p = { x: tank.x + Math.sin(tank.angle) * d, z: tank.z + Math.cos(tank.angle) * d };
        if (this.blocked(p, 0.1)) break;
        end = p;
      }
      this.event('arc', tank, { actor: tank.id, toX: end.x, toZ: end.z });
      return;
    }
    for (let i = 0; i < 3 && target; i++) {
      this.event('arc', from, { actor: tank.id, target: target.id, toX: target.x, toZ: target.z });
      this.hurt(
        target,
        32 * Math.pow(0.72, i) * (tank.damageUntil > this.state.time ? 2 : 1),
        tank.id,
      );
      hit.add(target.id);
      from = target;
      target = this.state.tanks
        .filter(
          (t) =>
            t.alive &&
            !allies(this.state, tank, t) &&
            !hit.has(t.id) &&
            distance(from, t) < 6 &&
            this.lineClear(from, t),
        )
        .sort((a, b) => distance(from, a) - distance(from, b))[0];
    }
  }
  private placeField(kind: Field['kind'], point: Vec2, owner: string, power = 1) {
    const s = this.state,
      sameBudget = s.fields.filter((f) => (f.kind === 'smoke') === (kind === 'smoke')),
      owned = sameBudget.filter((f) => f.owner === owner);
    if (owned.length >= (kind === 'smoke' ? 1 : 2))
      s.fields = s.fields.filter((f) => f.id !== owned[0].id);
    if (sameBudget.length >= 8) s.fields = s.fields.filter((f) => f.id !== sameBudget[0].id);
    s.fields.push({
      id: ++this.serial,
      kind,
      owner,
      x: point.x,
      z: point.z,
      radius: kind === 'smoke' ? 4.5 : kind === 'gravity' ? 5.5 : 4.8,
      createdAt: s.time,
      triggerAt: s.time + (kind === 'orbital' ? 0.9 : 0),
      expiresAt: s.time + (kind === 'smoke' ? 5 : kind === 'gravity' ? 3.5 : 0.9),
      nextTick: s.time,
      damage: (kind === 'gravity' ? 6 : 64) * power,
    });
  }
  private updateFields(dt: number) {
    const s = this.state;
    for (const field of s.fields) {
      if (field.kind === 'smoke') continue;
      if (field.kind === 'orbital') {
        if (s.time >= field.triggerAt) {
          this.event('strike', field, { actor: field.owner, radius: field.radius });
          this.explode(field, field.radius, field.damage, field.owner, 'orbital', true);
        }
        continue;
      }
      if (s.time >= field.expiresAt) {
        this.explode(field, 3, 22 * (field.damage / 6), field.owner, 'gravity', true);
        continue;
      }
      const pulse = s.time >= field.nextTick;
      if (pulse) field.nextTick = s.time + 0.35;
      for (const t of s.tanks) {
        const gap = distance(t, field);
        if (
          !t.alive ||
          this.friendly(field.owner, t) ||
          gap >= field.radius ||
          t.shieldUntil > s.time ||
          t.invulnerableUntil > s.time
        )
          continue;
        if (gap > 0.3) {
          const force = (1 - gap / field.radius) * 6 + 1;
          displace(
            t,
            ((field.x - t.x) / gap) * force * dt,
            ((field.z - t.z) / gap) * force * dt,
            s.obstacles,
          );
        }
        if (pulse) this.hurt(t, field.damage, field.owner);
      }
    }
    s.fields = s.fields.filter((f) => s.time < f.expiresAt);
  }
  private detonate(b: Bullet) {
    b.life = 0;
    if (b.kind === 'gravity') this.placeField('gravity', b, b.owner, b.damage / 4);
    else if (b.kind === 'cluster') {
      this.explode(b, 2.8, b.damage, b.owner, 'cluster', true);
      for (let i = 0; i < 6 && this.state.bullets.length < 256; i++) {
        const angle = (i * Math.PI) / 3,
          fragment: Bullet = {
            id: ++this.serial,
            owner: b.owner,
            x: b.x,
            z: b.z,
            vx: Math.sin(angle) * 22,
            vz: Math.cos(angle) * 22,
            damage: b.damage * 0.5,
            life: 0.48,
            kind: 'standard',
          };
        this.state.bullets.push(fragment);
        this.bulletHits.set(fragment.id, new Set());
      }
    }
  }
  private fire(tank: Tank) {
    tank.revealedUntil = this.state.time + 0.8;
    if (tank.weapon === 'lightning') {
      this.lightning(tank);
      return;
    }
    if (tank.weapon === 'orbital') {
      tank.nextFire = this.state.time + 1.5;
      const target = this.aimTarget(tank, 18, false);
      const point = target || {
        x: clamp(tank.x + Math.sin(tank.angle) * 12, -22, 22),
        z: clamp(tank.z + Math.cos(tank.angle) * 12, -22, 22),
      };
      this.placeField('orbital', point, tank.id, tank.damageUntil > this.state.time ? 2 : 1);
      this.event('shot', tank, { actor: tank.id, label: 'orbital' });
      return;
    }
    const weapon = tank.weapon,
      stats = TANK_CLASSES[tank.classId];
    const cooldown =
      weapon === 'gravity'
        ? 1.6
        : weapon === 'cluster'
          ? 0.85
          : weapon === 'ricochet'
            ? 0.36
            : weapon === 'rapid'
              ? 0.13
              : weapon === 'flame'
                ? 0.09
                : weapon === 'rail'
                  ? 0.95
                  : weapon === 'homing'
                    ? 0.65
                    : stats.cooldown;
    tank.nextFire = this.state.time + cooldown;
    if (this.state.bullets.length >= 256) return;
    const angles =
      weapon === 'scatter'
        ? [-0.2, 0, 0.2]
        : [weapon === 'flame' ? (this.random() - 0.5) * 0.3 : 0];
    for (const offset of angles) {
      const a = tank.angle + offset,
        speed =
          weapon === 'gravity'
            ? 18
            : weapon === 'ricochet'
              ? 30
              : weapon === 'cluster'
                ? 23
                : weapon === 'rail'
                  ? 65
                  : weapon === 'homing'
                    ? 17
                    : weapon === 'flame'
                      ? 16
                      : 27;
      const damage =
        (weapon === 'gravity'
          ? 4
          : weapon === 'cluster'
            ? 20
            : weapon === 'ricochet'
              ? 27
              : weapon === 'rail'
                ? 52
                : weapon === 'rapid'
                  ? 11
                  : weapon === 'flame'
                    ? 6
                    : weapon === 'homing'
                      ? 35
                      : weapon === 'scatter'
                        ? 20
                        : tank.classId === 'bastion'
                          ? 33
                          : 25) * (tank.damageUntil > this.state.time ? 2 : 1);
      const b: Bullet = {
        id: ++this.serial,
        owner: tank.id,
        x: tank.x + Math.sin(a) * 0.95,
        z: tank.z + Math.cos(a) * 0.95,
        vx: Math.sin(a) * speed,
        vz: Math.cos(a) * speed,
        damage,
        life:
          weapon === 'gravity'
            ? 0.65
            : weapon === 'cluster'
              ? 1.25
              : weapon === 'ricochet'
                ? 3.5
                : weapon === 'flame'
                  ? 0.43
                  : 2.3,
        kind: weapon,
        bounces: weapon === 'ricochet' ? 3 : undefined,
      };
      this.state.bullets.push(b);
      this.bulletHits.set(b.id, new Set());
    }
    this.event(
      'shot',
      { x: tank.x + Math.sin(tank.angle) * 1.8, z: tank.z + Math.cos(tank.angle) * 1.8 },
      { actor: tank.id, label: weapon },
    );
  }
  private updateBullet(b: Bullet, dt: number) {
    b.life -= dt;
    if (b.life <= 0) {
      this.detonate(b);
      return;
    }
    if (b.kind === 'homing') {
      const target = this.state.tanks
        .filter((t) => {
          const owner = this.state.tanks.find((o) => o.id === b.owner);
          return (
            t.alive &&
            !this.friendly(b.owner, t) &&
            distance(b, t) < 18 &&
            !!owner &&
            canSpot(this.state, owner, t)
          );
        })
        .sort((a, c) => distance(a, b) - distance(c, b))[0];
      if (target) {
        const len = distance(b, target) || 1;
        b.vx += ((target.x - b.x) / len) * 24 * dt;
        b.vz += ((target.z - b.z) / len) * 24 * dt;
        const speed = Math.hypot(b.vx, b.vz);
        b.vx = (b.vx / speed) * 17;
        b.vz = (b.vz / speed) * 17;
      }
    }
    const steps = Math.ceil((Math.hypot(b.vx, b.vz) * dt) / 0.3);
    for (let n = 0; n < steps && b.life > 0; n++) {
      const previousX = b.x,
        previousZ = b.z;
      b.x += (b.vx * dt) / steps;
      b.z += (b.vz * dt) / steps;
      if (Math.abs(b.x) > 24 || Math.abs(b.z) > 24) {
        if (b.kind === 'ricochet' && (b.bounces || 0) > 0) {
          if (Math.abs(b.x) > 24) b.vx = -b.vx;
          if (Math.abs(b.z) > 24) b.vz = -b.vz;
          b.x = previousX;
          b.z = previousZ;
          b.bounces!--;
          this.event('hit', b, { label: 'ricochet' });
        } else {
          b.x = previousX;
          b.z = previousZ;
          this.detonate(b);
          b.life = 0;
        }
        break;
      }
      const obstacle = this.state.obstacles.find((o) => circleHitsBox(b, 0.13, o));
      if (obstacle) {
        const obstacleKey = `obstacle-${obstacle.id}`;
        if (obstacle.hp > 0 && !this.bulletHits.get(b.id)?.has(obstacleKey)) {
          this.bulletHits.get(b.id)?.add(obstacleKey);
          obstacle.hp -= b.damage;
          if (obstacle.hp <= 0) {
            this.state.obstacles = this.state.obstacles.filter((o) => o.id !== obstacle.id);
            if (obstacle.kind === 'barrel') this.explode(obstacle, 4.3, 70, b.owner);
            else this.event('explosion', obstacle, { label: 'crate' });
          }
        }
        if (
          b.kind === 'ricochet' &&
          (b.bounces || 0) > 0 &&
          this.state.obstacles.includes(obstacle)
        ) {
          const hitX = circleHitsBox({ x: b.x, z: previousZ }, 0.13, obstacle);
          const hitZ = circleHitsBox({ x: previousX, z: b.z }, 0.13, obstacle);
          if (hitX) b.vx = -b.vx;
          if (hitZ) b.vz = -b.vz;
          if (!hitX && !hitZ) {
            b.vx = -b.vx;
            b.vz = -b.vz;
          }
          b.x = previousX;
          b.z = previousZ;
          b.bounces!--;
          if (circleHitsBox(b, 0.13, obstacle)) {
            if (hitX)
              b.x = obstacle.x + Math.sign(b.x - obstacle.x || b.vx) * (obstacle.w / 2 + 0.16);
            else b.z = obstacle.z + Math.sign(b.z - obstacle.z || b.vz) * (obstacle.d / 2 + 0.16);
          }
          this.event('hit', b, { label: 'ricochet' });
          break;
        }
        if (b.kind === 'gravity' || b.kind === 'cluster') {
          b.x = previousX;
          b.z = previousZ;
          this.detonate(b);
          break;
        }
        if (b.kind !== 'rail' || obstacle.hp === -1) {
          b.life = 0;
          this.event('hit', b);
          break;
        }
      }
      for (const t of this.state.tanks)
        if (
          t.alive &&
          !this.friendly(b.owner, t) &&
          distance(t, b) < TANK_RADIUS + 0.18 &&
          !this.bulletHits.get(b.id)?.has(t.id)
        ) {
          this.bulletHits.get(b.id)?.add(t.id);
          if (b.kind === 'cluster') {
            this.detonate(b);
            break;
          }
          this.hurt(t, b.damage, b.owner);
          this.event('hit', b, { target: t.id, actor: b.owner });
          if (b.kind === 'gravity') {
            this.detonate(b);
            break;
          }
          if (b.kind !== 'rail') b.life = 0;
          break;
        }
    }
  }
  hurt(tank: Tank, damage: number, owner: string) {
    const s = this.state;
    if (
      !tank.alive ||
      tank.invulnerableUntil > s.time ||
      tank.shieldUntil > s.time ||
      (s.mode === 'control' && this.friendly(owner, tank))
    )
      return;
    tank.hp = Math.max(0, tank.hp - damage);
    if (tank.hp <= 0) {
      tank.alive = false;
      tank.deaths++;
      tank.respawnAt = s.time + 3;
      const killer = s.tanks.find((t) => t.id === owner);
      if (killer && killer.id !== tank.id) killer.kills++;
      this.event('explosion', tank, { target: tank.id, actor: owner });
      this.event('kill', tank, { target: tank.id, actor: owner });
    }
  }
  private explode(
    p: Vec2,
    radius: number,
    damage: number,
    owner: string,
    label?: string,
    immuneOwner = false,
  ) {
    this.event('explosion', p, { radius, label, actor: owner });
    for (const t of this.state.tanks)
      if (t.alive && (!immuneOwner || t.id !== owner) && distance(p, t) < radius)
        this.hurt(t, damage * (1 - (distance(p, t) / radius) * 0.5), owner);
  }
  applyPickup(t: Tank, kind: PickupKind) {
    const time = this.state.time;
    if (WEAPON_PICKUPS.includes(kind as Weapon)) {
      t.weapon = kind as Weapon;
      t.weaponUntil = time + 12;
    } else if (kind === 'shield') t.shieldUntil = time + 7;
    else if (kind === 'speed') t.speedUntil = time + 10;
    else if (kind === 'repair') t.hp = Math.min(t.maxHp, t.hp + 60);
    else if (kind === 'mines') t.mines = Math.min(3, t.mines + 2);
    else if (kind === 'damage') t.damageUntil = time + 8;
    else if (kind === 'frost') {
      this.event('frost', t, { actor: t.id, radius: 8 });
      for (const enemy of this.state.tanks)
        if (
          !allies(this.state, t, enemy) &&
          enemy.alive &&
          distance(t, enemy) < 8 &&
          enemy.shieldUntil <= time &&
          enemy.invulnerableUntil <= time
        ) {
          this.hurt(enemy, 18, t.id);
          enemy.slowUntil = Math.max(enemy.slowUntil, time + 3);
        }
    }
    this.event('pickup', t, { actor: t.id, label: kind });
  }
  private respawn(t: Tank) {
    const enemies = this.state.tanks.filter((e) => e.alive && !allies(this.state, t, e));
    const spawn = [...(t.team ? this.teamSpawns(t.team) : SPAWNS)].sort(
      (a, b) =>
        Math.min(...enemies.map((e) => distance(b, e)), 100) -
        Math.min(...enemies.map((e) => distance(a, e)), 100),
    )[0];
    Object.assign(t, spawn, {
      hp: t.maxHp,
      alive: true,
      invulnerableUntil: this.state.time + 2.5,
      weapon: 'standard',
      weaponUntil: 0,
      shieldUntil: 0,
      speedUntil: 0,
      damageUntil: 0,
      slowUntil: 0,
      mines: 2,
      radarUntil: 0,
      revealedUntil: 0,
      dashUntil: 0,
      dashReadyAt: 0,
      nextMine: 0,
    });
    this.paths.delete(t.id);
  }
  removePlayer(id: string) {
    this.state.tanks = this.state.tanks.filter((t) => t.id !== id);
    this.inputs.delete(id);
    this.paths.delete(id);
    this.queuedActions.delete(id);
    this.state.fields = this.state.fields.filter((f) => f.owner !== id);
    for (const b of this.state.bullets) if (b.owner === id) this.bulletHits.delete(b.id);
    this.state.bullets = this.state.bullets.filter((b) => b.owner !== id);
    this.state.mines = this.state.mines.filter((m) => m.owner !== id);
  }
}
