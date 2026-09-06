import * as THREE from 'three';
import { PICKUPS, TEAMS, type Field, type GameEvent, type GameState } from '../../shared/types';

const glow = (color: number, opacity = 0.8) =>
  new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.NormalBlending,
    toneMapped: false,
    side: THREE.DoubleSide,
  });
type Transient = {
  object: THREE.Object3D;
  start: number;
  duration: number;
  kind: string;
  radius: number;
};
export class TacticalEffects {
  private fields = new Map<number, THREE.Group>();
  private transients: Transient[] = [];
  private dummy = new THREE.Object3D();
  constructor(private scene: THREE.Scene) {}
  private dispose(object: THREE.Object3D) {
    object.removeFromParent();
    const geometries = new Set<THREE.BufferGeometry>(),
      materials = new Set<THREE.Material>();
    object.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Line) {
        geometries.add(o.geometry);
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m);
      }
    });
    geometries.forEach((g) => g.dispose());
    materials.forEach((m) => m.dispose());
  }
  private ring(radius: number, color: number, arc = Math.PI * 2) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.045, 5, 48, arc), glow(color));
    ring.rotation.x = Math.PI / 2;
    return ring;
  }
  private create(field: Field) {
    const group = new THREE.Group();
    group.position.set(field.x, 0, field.z);
    if (field.kind === 'smoke') {
      const cloud = new THREE.InstancedMesh(
        new THREE.IcosahedronGeometry(1, 1),
        glow(0xc3d4d3, 0.27),
        18,
      );
      cloud.frustumCulled = false;
      group.add(cloud);
      group.userData.cloud = cloud;
      const ring = this.ring(field.radius, 0xb2d8ce);
      ring.position.y = 0.08;
      group.add(ring);
    } else if (field.kind === 'gravity') {
      for (let i = 0; i < 3; i++) {
        const ring = this.ring(
          field.radius * (0.35 + i * 0.3),
          i % 2 ? 0xcf9aff : 0x9165ff,
          Math.PI * 1.65,
        );
        ring.position.y = 0.2 + i * 0.18;
        ring.userData.spin = (i % 2 ? -1 : 1) * (1 + i * 0.5);
        group.add(ring);
      }
      const core = new THREE.Mesh(
        new THREE.SphereGeometry(0.48, 16, 10),
        new THREE.MeshBasicMaterial({ color: 0x150c25 }),
      );
      core.position.y = 0.65;
      group.add(core);
      const horizon = this.ring(0.63, 0xecbdff);
      horizon.position.y = 0.65;
      horizon.rotation.x = 1.1;
      group.add(horizon);
      const particles = new THREE.InstancedMesh(
        new THREE.IcosahedronGeometry(0.08, 0),
        glow(0xcab5ff),
        28,
      );
      particles.frustumCulled = false;
      group.add(particles);
      group.userData.particles = particles;
    } else {
      const disc = new THREE.Mesh(
        new THREE.CircleGeometry(field.radius, 40),
        glow(0xff593e, 0.075),
      );
      disc.rotation.x = -Math.PI / 2;
      disc.position.y = 0.06;
      group.add(disc);
      const outer = this.ring(field.radius, 0xff7756);
      outer.position.y = 0.1;
      group.add(outer);
      const countdown = this.ring(field.radius, 0xffd986);
      countdown.position.y = 0.12;
      group.add(countdown);
      group.userData.countdown = countdown;
      for (const angle of [0, Math.PI / 2]) {
        const bar = new THREE.Mesh(
          new THREE.BoxGeometry(field.radius * 1.7, 0.03, 0.04),
          glow(0xffb887, 0.7),
        );
        bar.rotation.y = angle;
        bar.position.y = 0.08;
        group.add(bar);
      }
      const marker = new THREE.Mesh(new THREE.OctahedronGeometry(0.28, 0), glow(0xffd38c));
      marker.position.y = 2;
      group.add(marker);
    }
    this.scene.add(group);
    return group;
  }
  sync(state: GameState) {
    const active = new Set(state.fields.map((f) => f.id));
    for (const [id, group] of this.fields)
      if (!active.has(id)) {
        this.dispose(group);
        this.fields.delete(id);
      }
    for (const f of state.fields) if (!this.fields.has(f.id)) this.fields.set(f.id, this.create(f));
  }
  emit(event: GameEvent, now: number) {
    if (this.transients.length >= 64) return;
    let object: THREE.Object3D, duration: number;
    if (event.type === 'arc') {
      if (event.toX === undefined || event.toZ === undefined) return;
      const group = new THREE.Group(),
        points: THREE.Vector3[] = [];
      for (let i = 0; i <= 12; i++) {
        const t = i / 12,
          noise = i === 0 || i === 12 ? 0 : Math.sin(event.id * 13 + i * 17) * 0.24;
        points.push(
          new THREE.Vector3(
            event.x + (event.toX - event.x) * t + noise,
            1.3 + Math.sin(i * 4) * noise,
            event.z + (event.toZ - event.z) * t - noise,
          ),
        );
      }
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      group.add(
        new THREE.Line(
          geometry,
          new THREE.LineBasicMaterial({
            color: 0xd9faff,
            transparent: true,
            opacity: 1,
            blending: THREE.NormalBlending,
            toneMapped: false,
            depthWrite: false,
          }),
        ),
      );
      const echo = new THREE.Line(
        geometry,
        new THREE.LineBasicMaterial({
          color: 0x428cff,
          transparent: true,
          opacity: 0.6,
          blending: THREE.NormalBlending,
          toneMapped: false,
          depthWrite: false,
        }),
      );
      echo.position.y = 0.06;
      group.add(echo);
      object = group;
      duration = 0.22;
    } else if (event.type === 'strike') {
      const group = new THREE.Group();
      group.position.set(event.x, 0, event.z);
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.65, 22, 12), glow(0xffe5b0));
      beam.position.y = 11;
      group.add(beam);
      const corona = new THREE.Mesh(
        new THREE.CylinderGeometry(0.55, 1.1, 22, 12),
        glow(0xff885b, 0.28),
      );
      corona.position.y = 11;
      group.add(corona);
      const ring = this.ring(1, 0xffe6aa);
      ring.position.y = 0.08;
      group.add(ring);
      object = group;
      duration = 0.5;
    } else if (event.type === 'radar' || event.type === 'pickup' || event.type === 'capture') {
      const group = new THREE.Group();
      group.position.set(event.x, 0.15, event.z);
      const color =
        event.type === 'pickup'
          ? Number.parseInt(
              PICKUPS[event.label as keyof typeof PICKUPS]?.color.slice(1) || 'ffffff',
              16,
            )
          : 0x7cf6db;
      group.add(this.ring(1, color), this.ring(0.72, color));
      object = group;
      duration = event.type === 'radar' ? 1.2 : 0.7;
    } else if (event.type === 'frost') {
      const group = new THREE.Group();
      group.position.set(event.x, 0.1, event.z);
      group.add(this.ring(1, 0xc1faff));
      const second = this.ring(0.8, 0x6acbff);
      second.position.y = 0.17;
      group.add(second);
      for (let i = 0; i < 12; i++) {
        const crystal = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.7, 4), glow(0xc8faff, 0.7));
        crystal.position.set(Math.sin((i * Math.PI) / 6), 0.28, Math.cos((i * Math.PI) / 6));
        group.add(crystal);
      }
      object = group;
      duration = 0.6;
    } else return;
    this.scene.add(object);
    this.transients.push({
      object,
      start: now,
      duration,
      kind: event.type,
      radius: event.radius || 1,
    });
  }
  animate(state: GameState, now: number) {
    for (const f of state.fields) {
      const group = this.fields.get(f.id);
      if (!group) continue;
      const age = state.time - f.createdAt;
      if (f.kind === 'smoke') {
        const cloud = group.userData.cloud as THREE.InstancedMesh;
        const fade = Math.min(1, age * 3, (f.expiresAt - state.time) * 2);
        (cloud.material as THREE.Material).opacity = 0.27 * fade;
        for (let i = 0; i < 18; i++) {
          const angle = i * 2.4 + age * 0.06,
            r = Math.sqrt(i / 18) * f.radius * 0.75;
          this.dummy.position.set(Math.sin(angle) * r, 0.6 + (i % 3) * 0.5, Math.cos(angle) * r);
          this.dummy.scale.set(1.4, 0.8, 1.4);
          this.dummy.updateMatrix();
          cloud.setMatrixAt(i, this.dummy.matrix);
        }
        cloud.instanceMatrix.needsUpdate = true;
      } else if (f.kind === 'gravity') {
        group.children.forEach((o, i) => {
          if (o.userData.spin) o.rotation.z = now * 0.001 * o.userData.spin;
          if (i === 4) o.rotation.z = now * 0.002;
        });
        const particles = group.userData.particles as THREE.InstancedMesh;
        for (let i = 0; i < 28; i++) {
          const phase = (((i * 0.618 - age * 0.42) % 1) + 1) % 1,
            r = 0.5 + phase * (f.radius - 0.5),
            angle = i * 2.4 + age * 3;
          this.dummy.position.set(
            Math.sin(angle) * r,
            0.25 + (1 - phase) * 1.15,
            Math.cos(angle) * r,
          );
          this.dummy.scale.setScalar(0.5 + phase);
          this.dummy.updateMatrix();
          particles.setMatrixAt(i, this.dummy.matrix);
        }
        particles.instanceMatrix.needsUpdate = true;
      } else {
        const progress = THREE.MathUtils.clamp(age / (f.triggerAt - f.createdAt), 0, 1);
        (group.userData.countdown as THREE.Mesh).scale.setScalar(Math.max(0.03, 1 - progress));
        const marker = group.children[group.children.length - 1];
        marker.rotation.y = now * 0.004;
        marker.position.y = 1.4 + Math.sin(now * 0.012) * 0.2;
      }
    }
    this.transients = this.transients.filter((t) => {
      const progress = (now - t.start) / (t.duration * 1000);
      if (progress >= 1) {
        this.dispose(t.object);
        return false;
      }
      if (t.kind === 'radar' || t.kind === 'pickup' || t.kind === 'capture')
        t.object.scale.setScalar(0.3 + progress * (t.kind === 'radar' ? 18 : 3));
      if (t.kind === 'frost')
        t.object.scale.set(0.5 + progress * t.radius, 1, 0.5 + progress * t.radius);
      if (t.kind === 'strike') {
        t.object.scale.x = t.object.scale.z = 1 + progress * 0.7;
        const ring = t.object.children[2];
        ring.scale.setScalar(1 + progress * t.radius);
      }
      t.object.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.Line)
          (o.material as THREE.Material).opacity = (1 - progress) * (t.kind === 'arc' ? 1 : 0.85);
      });
      return true;
    });
  }
  destroy() {
    for (const group of this.fields.values()) this.dispose(group);
    for (const t of this.transients) this.dispose(t.object);
    this.fields.clear();
    this.transients = [];
  }
}
