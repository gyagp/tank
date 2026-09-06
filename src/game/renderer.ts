import * as THREE from 'three';
import {
  ARENA_SIZE,
  MAPS,
  PICKUPS,
  type GameState,
  type InputState,
  type MapId,
  type Obstacle,
} from '../../shared/types';
import { box, cylinder, makeTank } from './models';
import { GameAudio } from './audio';
import { batchRigidParts } from './batching';
import { predictLocalPosition } from './prediction';
import { AdaptiveQuality } from './quality';
import { SupplyEffects } from './supplies';
import { ObjectiveEffects } from './objectives';
import { visibleTanks } from '../../shared/tactics';
import { TacticalEffects } from './tactical-effects';

type TankModel = ReturnType<typeof makeTank>;
interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  size: number;
  color: THREE.Color;
}
export class ArenaRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera();
  private state: GameState | null = null;
  private tanks = new Map<string, TankModel>();
  private obstacles = new Map<number, THREE.Group>();
  private supplies: SupplyEffects;
  private objectives: ObjectiveEffects;
  private visible = new Set<string>();
  private bullets = new Map<number, THREE.Mesh>();
  private bulletPool = new Map<string, THREE.Mesh[]>();
  private mines = new Map<number, THREE.Group>();
  private particles: Particle[] = [];
  private particleMesh: THREE.InstancedMesh;
  private dummy = new THREE.Object3D();
  private frame = 0;
  private lastTime = 0;
  private qualityWarmupUntil = performance.now() + 2500;
  private eventId = 0;
  private shake = 0;
  private width = 0;
  private height = 0;
  private resizeObserver: ResizeObserver;
  private target = new THREE.Vector3();
  private pointer = new THREE.Vector2();
  private raycaster = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -1.1);
  private aimPoint = new THREE.Vector3();
  private lastDust = 0;
  private lastSnapshotAt = 0;
  private lastShadowAt = 0;
  private nextPosition = new THREE.Vector3();
  private projected = new THREE.Vector3();
  private predicted = { x: 0, z: 0 };
  private quality = new AdaptiveQuality(Math.min(window.devicePixelRatio, 1.5));
  readInput?: () => InputState;
  private glowTexture: THREE.CanvasTexture;
  private tactical: TacticalEffects;
  private flashes: {
    mesh: THREE.Sprite;
    life: number;
    max: number;
    size: number;
    smoke: boolean;
  }[] = [];
  private rings: { mesh: THREE.Mesh; life: number; max: number }[] = [];
  reducedMotion = false;
  onLabels?: (labels: { id: string; x: number; y: number; visible: boolean }[]) => void;
  constructor(
    private container: HTMLDivElement,
    private map: MapId,
    private playerId: string,
    private audio: GameAudio,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    const gl = this.renderer.getContext();
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    const device = debug ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : '';
    this.renderer.setPixelRatio(this.quality.scale);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.domElement.setAttribute('aria-label', '3D 坦克战场');
    this.container.appendChild(this.renderer.domElement);
    this.renderer.domElement.dataset.renderer = 'webgl';
    this.renderer.domElement.dataset.gpu = device;
    const palette = MAPS[map];
    this.scene.background = new THREE.Color(palette.fog);
    this.scene.fog = new THREE.Fog(palette.fog, 55, 115);
    this.scene.add(
      new THREE.HemisphereLight(map === 'arctic' ? 0xe4f3ff : 0xffefda, 0x464d43, 1.8),
    );
    const sun = new THREE.DirectionalLight(map === 'arctic' ? 0xe5eeff : 0xffefd3, 2.7);
    sun.position.set(-20, 35, -15);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -36;
    sun.shadow.camera.right = 36;
    sun.shadow.camera.top = 36;
    sun.shadow.camera.bottom = -36;
    sun.shadow.camera.far = 100;
    sun.shadow.normalBias = 0.04;
    sun.shadow.bias = -0.0003;
    this.scene.add(sun);
    const glowCanvas = document.createElement('canvas');
    glowCanvas.width = glowCanvas.height = 64;
    const glowCtx = glowCanvas.getContext('2d')!;
    const gradient = glowCtx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.2, 'rgba(255,255,255,0.8)');
    gradient.addColorStop(0.55, 'rgba(255,255,255,0.2)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    glowCtx.fillStyle = gradient;
    glowCtx.fillRect(0, 0, 64, 64);
    this.glowTexture = new THREE.CanvasTexture(glowCanvas);
    this.createEnvironment();
    this.tactical = new TacticalEffects(this.scene);
    this.supplies = new SupplyEffects(this.scene);
    this.objectives = new ObjectiveEffects(this.scene);
    this.particleMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9 }),
      600,
    );
    this.particleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.particleMesh.frustumCulled = false;
    this.particleMesh.count = 0;
    this.scene.add(this.particleMesh);
    this.camera.position.set(0, 42, 32);
    this.camera.lookAt(0, 0, 0);
    this.camera.near = 0.1;
    this.camera.far = 160;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.frame = requestAnimationFrame(this.animate);
  }
  private resize() {
    this.width = this.container.clientWidth;
    this.height = this.container.clientHeight;
    const aspect = this.width / Math.max(1, this.height),
      span = aspect < 1 ? 42 : 34;
    this.camera.left = (-span * aspect) / 2;
    this.camera.right = (span * aspect) / 2;
    this.camera.top = span / 2;
    this.camera.bottom = -span / 2;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.width, this.height);
  }
  private createEnvironment() {
    const palette = MAPS[this.map];
    const environment = new THREE.Group();
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1024;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = `#${palette.ground.toString(16)}`;
    ctx.fillRect(0, 0, 1024, 1024);
    let seed = 53;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < 55000; i++) {
      const n = rand();
      ctx.fillStyle = n > 0.5 ? 'rgba(255,245,217,0.07)' : 'rgba(35,36,28,0.06)';
      ctx.fillRect(rand() * 1024, rand() * 1024, rand() * 3 + 1, rand() * 3 + 1);
    }
    // Concrete tile joins and weathered tyre marks give the ground an authored surface.
    ctx.strokeStyle = 'rgba(58,61,51,0.12)';
    ctx.lineWidth = 2;
    for (let i = 0; i <= 8; i++) {
      ctx.beginPath();
      ctx.moveTo(i * 128, 0);
      ctx.lineTo(i * 128, 1024);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i * 128);
      ctx.lineTo(1024, i * 128);
      ctx.stroke();
    }
    for (let i = 0; i < 20; i++) {
      ctx.save();
      ctx.translate(rand() * 1024, rand() * 1024);
      ctx.rotate(rand() * 6.28);
      ctx.fillStyle = 'rgba(49,48,40,0.075)';
      for (let j = 0; j < 30; j++) {
        ctx.fillRect(-9, j * 5, 5, 2);
        ctx.fillRect(9, j * 5, 5, 2);
      }
      ctx.restore();
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(ARENA_SIZE, ARENA_SIZE),
      new THREE.MeshStandardMaterial({ map: texture, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    environment.add(ground);
    const outside = new THREE.Mesh(
      new THREE.PlaneGeometry(180, 180),
      new THREE.MeshStandardMaterial({ color: palette.ground, roughness: 1 }),
    );
    outside.rotation.x = -Math.PI / 2;
    outside.position.y = -0.1;
    outside.receiveShadow = true;
    environment.add(outside);
    const metal = new THREE.MeshStandardMaterial({ color: palette.wall, roughness: 0.9 });
    const stripe = new THREE.MeshStandardMaterial({ color: 0xe7af4e });
    for (const side of [-1, 1])
      for (let i = -22; i <= 22; i += 4) {
        box(environment, 3.8, 0.8, 0.65, i, 0.4, side * 24.45, metal, true);
        box(environment, 0.65, 0.8, 3.8, side * 24.45, 0.4, i, metal, true);
        box(environment, 0.24, 0.05, 0.7, i, 0.83, side * 24.45, stripe);
      }
    const pads = new THREE.MeshStandardMaterial({
      color: 0xead8ae,
      transparent: true,
      opacity: 0.15,
      depthWrite: false,
    });
    for (const [x, z] of [
      [-19, -19],
      [19, 19],
      [-19, 19],
      [19, -19],
    ]) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(2.2, 2.28, 48), pads);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(x, 0.025, z);
      environment.add(ring);
    }
    const rockMaterial = new THREE.MeshStandardMaterial({
      color: this.map === 'arctic' ? 0xb4c5cb : 0x9b8c73,
      roughness: 1,
    });
    const trunk = new THREE.MeshStandardMaterial({ color: 0x555444 });
    const foliage = [0x526650, 0x61785c].map((color) => new THREE.MeshStandardMaterial({ color }));
    for (let i = 0; i < 60; i++) {
      const side = i % 4,
        r = 27 + rand() * 16,
        along = (rand() - 0.5) * 85,
        x = side < 2 ? (side === 0 ? -r : r) : along,
        z = side >= 2 ? (side === 2 ? -r : r) : along;
      if (this.map === 'forest') {
        cylinder(environment, 0.17, 0.28, 2, x, 1, z, trunk, 6);
        const tree = new THREE.Mesh(
          new THREE.ConeGeometry(1 + rand(), 3.5 + rand() * 2, 7),
          foliage[i % 2],
        );
        tree.position.set(x, 3, z);
        tree.castShadow = true;
        environment.add(tree);
      } else {
        const rock = new THREE.Mesh(
          new THREE.DodecahedronGeometry(0.7 + rand() * 1.6, 0),
          rockMaterial,
        );
        rock.position.set(x, 0.35, z);
        rock.scale.set(1.5, 0.65, 1);
        rock.rotation.y = rand() * 6;
        rock.castShadow = true;
        environment.add(rock);
      }
    }
    // Distant antenna tower.
    const tower = new THREE.Group();
    tower.position.set(-28, 0, -25);
    environment.add(tower);
    const steel = new THREE.MeshStandardMaterial({
      color: 0x62665c,
      metalness: 0.6,
      roughness: 0.6,
    });
    for (const x of [-1, 1]) for (const z of [-1, 1]) box(tower, 0.15, 7, 0.15, x, 3.5, z, steel);
    box(tower, 3.1, 0.3, 3.1, 0, 5.5, 0, steel);
    box(tower, 2.7, 1.8, 2.5, 0, 6.5, 0, metal);
    box(tower, 3.2, 0.2, 3.0, 0, 7.5, 0, steel);
    cylinder(tower, 0.04, 0.08, 4, 0, 9, 0, steel, 6);
    batchRigidParts(environment);
    this.scene.add(environment);
  }
  private obstacleModel(o: Obstacle) {
    const group = new THREE.Group();
    group.position.set(o.x, 0, o.z);
    if (o.kind === 'barrel') {
      const red = new THREE.MeshStandardMaterial({ color: 0x9d4c31, roughness: 0.8 });
      cylinder(group, 0.48, 0.48, o.h, 0, o.h / 2, 0, red, 16);
      for (const y of [0.22, 1.13])
        cylinder(
          group,
          0.495,
          0.495,
          0.08,
          0,
          y,
          0,
          new THREE.MeshStandardMaterial({ color: 0x3d443e }),
          16,
        );
      box(
        group,
        0.4,
        0.3,
        0.018,
        0,
        0.78,
        0.48,
        new THREE.MeshStandardMaterial({ color: 0xd8ae55 }),
      );
    } else if (o.kind === 'rock') {
      const rock = new THREE.Mesh(
        new THREE.DodecahedronGeometry(1, 0),
        new THREE.MeshStandardMaterial({ color: MAPS[this.map].wall, roughness: 1 }),
      );
      rock.scale.set(o.w * 0.6, o.h * 0.75, o.d * 0.6);
      rock.position.y = o.h * 0.5;
      rock.castShadow = true;
      rock.receiveShadow = true;
      group.add(rock);
    } else if (o.kind === 'crate') {
      const wood = new THREE.MeshStandardMaterial({ color: 0x9b835d, roughness: 0.85 });
      box(group, o.w, o.h, o.d, 0, o.h / 2, 0, wood, true);
      const frame = new THREE.MeshStandardMaterial({
        color: 0x596250,
        metalness: 0.4,
        roughness: 0.7,
      });
      for (const side of [-1, 1]) {
        box(group, 0.13, o.h + 0.08, o.d + 0.08, side * 0.54, o.h / 2, 0, frame);
        box(group, o.w + 0.08, 0.15, o.d + 0.08, 0, 0.22 + (side + 1) * 0.55, 0, frame);
      }
      box(
        group,
        0.45,
        0.28,
        0.02,
        0,
        o.h * 0.62,
        o.d / 2 + 0.02,
        new THREE.MeshStandardMaterial({ color: 0xdaca9d }),
      );
    } else {
      const material = new THREE.MeshStandardMaterial({
        color: MAPS[this.map].wall,
        roughness: 0.95,
      });
      box(group, o.w, o.h, o.d, 0, o.h / 2, 0, material, true);
      box(
        group,
        o.w + 0.1,
        0.13,
        o.d + 0.1,
        0,
        o.h - 0.04,
        0,
        new THREE.MeshStandardMaterial({ color: this.map === 'arctic' ? 0xd5e2e4 : 0x929481 }),
      );
      const rib = new THREE.MeshStandardMaterial({
        color: this.map === 'arctic' ? 0x586d76 : 0x626759,
      });
      if (o.w > o.d)
        for (let x = -o.w / 2 + 0.4; x < o.w / 2; x += 0.65)
          box(group, 0.09, o.h - 0.3, o.d + 0.03, x, o.h / 2, 0, rib);
      else
        for (let z = -o.d / 2 + 0.4; z < o.d / 2; z += 0.65)
          box(group, o.w + 0.03, o.h - 0.3, 0.09, 0, o.h / 2, z, rib);
    }
    batchRigidParts(group);
    this.scene.add(group);
    return group;
  }
  update(state: GameState) {
    this.state = state;
    this.visible = visibleTanks(state, this.playerId);
    this.supplies.sync(state, this.playerId);
    this.objectives.sync(state);
    this.tactical.sync(state);
    this.lastSnapshotAt = performance.now();
    for (const t of state.tanks)
      if (!this.tanks.has(t.id)) {
        const model = makeTank(t.classId, t.color);
        model.root.position.set(t.x, 0, t.z);
        this.tanks.set(t.id, model);
        this.scene.add(model.root);
      }
    for (const [id, model] of this.tanks)
      if (!state.tanks.some((t) => t.id === id)) {
        this.disposeObject(model.root);
        this.tanks.delete(id);
      }
    for (const o of state.obstacles)
      if (!this.obstacles.has(o.id)) this.obstacles.set(o.id, this.obstacleModel(o));
    for (const [id, obj] of this.obstacles)
      if (!state.obstacles.some((o) => o.id === id)) {
        this.disposeObject(obj);
        this.obstacles.delete(id);
      }
    for (const m of state.mines)
      if (!this.mines.has(m.id)) {
        const obj = new THREE.Group();
        cylinder(
          obj,
          0.4,
          0.48,
          0.15,
          0,
          0.12,
          0,
          new THREE.MeshStandardMaterial({ color: 0x454c3c }),
          12,
        );
        const light = new THREE.Mesh(
          new THREE.SphereGeometry(0.08, 8, 6),
          new THREE.MeshBasicMaterial({ color: 0xff4433 }),
        );
        light.position.y = 0.23;
        obj.add(light);
        obj.position.set(m.x, 0, m.z);
        this.scene.add(obj);
        this.mines.set(m.id, obj);
      }
    for (const [id, obj] of this.mines)
      if (!state.mines.some((m) => m.id === id)) {
        this.disposeObject(obj);
        this.mines.delete(id);
      }
    const me = state.tanks.find((t) => t.id === this.playerId);
    for (const e of state.events)
      if (e.id > this.eventId) {
        this.eventId = e.id;
        this.tactical.emit(e, performance.now());
        const dist = me ? Math.hypot(e.x - me.x, e.z - me.z) : 0;
        if (e.type === 'explosion') {
          const color =
            e.label === 'gravity' ? 0xba8dff : e.label === 'orbital' ? 0xffdf9e : 0xffad4d;
          this.burst(e.x, e.z, 36, color, 6);
          this.burst(e.x, e.z, 20, 0x494b41, 4);
          this.flash(e.x, e.z, color, 5.5, 0.5);
          this.flash(e.x, e.z, 0x3d3d35, 3.5, 1.5, true);
          const ring = new THREE.Mesh(
            new THREE.RingGeometry(0.8, 1, 40),
            new THREE.MeshBasicMaterial({
              color: 0xffd698,
              transparent: true,
              opacity: 0.7,
              side: THREE.DoubleSide,
              depthWrite: false,
            }),
          );
          ring.rotation.x = -Math.PI / 2;
          ring.position.set(e.x, 0.06, e.z);
          this.scene.add(ring);
          this.rings.push({ mesh: ring, life: 0.55, max: 0.55 });
          if (dist < 15) this.shake = 0.5 * (1 - dist / 20);
        }
        if (e.type === 'hit') {
          this.burst(e.x, e.z, 7, 0xffd289, 3);
          this.flash(e.x, e.z, 0xffdf91, 1.2, 0.15);
          if (e.target === this.playerId) this.shake = 0.16;
        }
        if (e.type === 'arc' && e.toX !== undefined && e.toZ !== undefined) {
          this.flash(e.toX, e.toZ, 0x95e6ff, 1.7, 0.18);
          this.burst(e.toX, e.toZ, 5, 0xb2f0ff, 2);
        }
        if (e.type === 'frost') this.burst(e.x, e.z, 20, 0xc4f4ff, 5);
        if (e.type === 'shot') {
          this.burst(e.x, e.z, 4, 0xffd16e, 1.5);
          this.flash(e.x, e.z, 0xffd16e, e.label === 'flame' ? 1.8 : 1.0, 0.1);
        }
        if (e.type === 'pickup')
          this.burst(
            e.x,
            e.z,
            18,
            Number.parseInt(
              PICKUPS[e.label as keyof typeof PICKUPS]?.color.slice(1) || 'ffffff',
              16,
            ),
            3,
          );
        if (e.type === 'dash') this.burst(e.x, e.z, 12, 0xd8c29c, 2.5);
        if (e.type !== 'kill') this.audio.play(e.type, dist);
      }
  }
  private burst(x: number, z: number, count: number, color: number, speed: number) {
    const n = this.reducedMotion ? Math.ceil(count / 3) : count;
    for (let i = 0; i < n && this.particles.length < 580; i++) {
      const life = 0.3 + Math.random() * 0.65;
      this.particles.push({
        x,
        y: 0.5 + Math.random(),
        z,
        vx: (Math.random() - 0.5) * speed,
        vy: Math.random() * speed,
        vz: (Math.random() - 0.5) * speed,
        life,
        max: life,
        size: 0.09 + Math.random() * 0.18,
        color: new THREE.Color(color),
      });
    }
  }
  private flash(x: number, z: number, color: number, size: number, life: number, smoke = false) {
    if (this.flashes.length > 100) return;
    const mesh = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.glowTexture,
        color,
        transparent: true,
        opacity: smoke ? 0.5 : 0.9,
        blending: smoke ? THREE.NormalBlending : THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    mesh.position.set(x, smoke ? 1 : 1.2, z);
    mesh.scale.setScalar(size);
    this.scene.add(mesh);
    this.flashes.push({ mesh, size, life, max: life, smoke });
  }
  aim(clientX: number, clientY: number): number | null {
    const me = this.tanks.get(this.playerId);
    if (!me) return null;
    const rect = this.container.getBoundingClientRect();
    this.pointer.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      (-(clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    if (this.raycaster.ray.intersectPlane(this.plane, this.aimPoint))
      return Math.atan2(this.aimPoint.x - me.root.position.x, this.aimPoint.z - me.root.position.z);
    return null;
  }
  localAim(input: InputState) {
    const me = this.tanks.get(this.playerId);
    if (me) me.turret.rotation.y = input.angle;
  }
  aimAtTank(id: string): number | null {
    const me = this.tanks.get(this.playerId),
      target = this.tanks.get(id);
    return me && target
      ? Math.atan2(
          target.root.position.x - me.root.position.x,
          target.root.position.z - me.root.position.z,
        )
      : null;
  }
  private animate = (now: number) => {
    this.frame = requestAnimationFrame(this.animate);
    const elapsed = this.lastTime ? (now - this.lastTime) / 1000 : 1 / 60;
    const dt = Math.min(elapsed, 0.1);
    this.lastTime = now;
    if (now >= this.qualityWarmupUntil && !document.hidden && this.quality.sample(elapsed)) {
      this.renderer.setPixelRatio(this.quality.scale);
      this.renderer.setSize(this.width, this.height);
    }
    // Keep soft shadows, but avoid redrawing every rigid part at display refresh rate.
    if (now - this.lastShadowAt >= 1000 / 20) {
      this.renderer.shadowMap.needsUpdate = true;
      this.lastShadowAt = now;
    }
    const state = this.state;
    if (state) {
      const input = this.readInput?.();
      const me = state.tanks.find((t) => t.id === this.playerId);
      if (me) {
        const limit = this.width < this.height ? 21 : 11;
        this.target.lerp(
          this.nextPosition.set(
            THREE.MathUtils.clamp(me.x, -limit, limit),
            0,
            THREE.MathUtils.clamp(me.z, -limit, limit),
          ),
          1 - Math.exp(-dt * 3),
        );
      }
      this.shake *= Math.exp(-dt * 10);
      const shake = this.reducedMotion ? 0 : this.shake;
      this.camera.position.set(
        this.target.x + (Math.random() - 0.5) * shake,
        42,
        this.target.z + 32 + (Math.random() - 0.5) * shake,
      );
      this.camera.lookAt(this.target);
      this.camera.updateMatrixWorld();
      for (const tank of state.tanks) {
        const model = this.tanks.get(tank.id)!;
        model.root.visible = tank.alive && this.visible.has(tank.id);
        if (!model.root.visible) continue;
        const own = tank.id === this.playerId;
        const position =
          own && input
            ? predictLocalPosition(
                this.predicted,
                tank,
                input,
                (now - this.lastSnapshotAt) / 1000,
                state.time,
                state.obstacles,
              )
            : tank;
        const next = this.nextPosition.set(position.x, 0, position.z);
        const gap = model.root.position.distanceToSquared(next);
        if (gap > 64) model.root.position.copy(next);
        else model.root.position.lerp(next, 1 - Math.exp(-dt * (own ? 45 : 18)));
        const bodyAngle =
          own && input && (input.x || input.z) ? Math.atan2(input.x, input.z) : tank.bodyAngle;
        model.chassis.rotation.y +=
          Math.atan2(
            Math.sin(bodyAngle - model.chassis.rotation.y),
            Math.cos(bodyAngle - model.chassis.rotation.y),
          ) *
          (1 - Math.exp(-dt * 12));
        model.turret.rotation.y = own && input ? input.angle : tank.angle;
        model.shield.visible =
          tank.shieldUntil > state.time ||
          tank.invulnerableUntil > state.time ||
          tank.slowUntil > state.time;
        (model.shield.material as THREE.MeshBasicMaterial).opacity =
          tank.slowUntil > state.time ? 0.075 : 0.14;
        model.shield.rotation.y = now * 0.0003;
        model.ring.visible = tank.id === this.playerId;
        if (now - this.lastDust > 70 && gap > 0.01) {
          this.burst(tank.x, tank.z, 1, MAPS[this.map].ground, 0.5);
        }
      }
      if (now - this.lastDust > 70) this.lastDust = now;
      for (const b of state.bullets) {
        let mesh = this.bullets.get(b.id);
        if (!mesh) {
          mesh =
            this.bulletPool.get(b.kind)?.pop() ||
            new THREE.Mesh(
              new THREE.SphereGeometry(
                b.kind === 'gravity'
                  ? 0.3
                  : b.kind === 'cluster'
                    ? 0.2
                    : b.kind === 'flame'
                      ? 0.24
                      : 0.1,
                6,
                6,
              ),
              new THREE.MeshBasicMaterial({
                color:
                  b.kind === 'standard'
                    ? 0xffdb6e
                    : Number.parseInt(PICKUPS[b.kind].color.slice(1), 16),
              }),
            );
          mesh.userData.kind = b.kind;
          mesh.scale.set(1, 1, b.kind === 'rail' ? 10 : b.kind === 'flame' ? 1.5 : 3);
          mesh.position.set(b.x, 1.1, b.z);
          this.bullets.set(b.id, mesh);
          this.scene.add(mesh);
        }
        mesh.position.lerp(this.nextPosition.set(b.x, 1.1, b.z), Math.min(1, dt * 28));
        mesh.rotation.y = Math.atan2(b.vx, b.vz);
      }
      for (const [id, obj] of this.bullets)
        if (!state.bullets.some((b) => b.id === id)) {
          this.scene.remove(obj);
          const pool = this.bulletPool.get(obj.userData.kind) || [];
          if (pool.length < 32) {
            pool.push(obj);
            this.bulletPool.set(obj.userData.kind, pool);
          } else this.disposeObject(obj);
          this.bullets.delete(id);
        }
      this.supplies.animate(now, this.reducedMotion);
      const labels = state.tanks.map((t) => {
        const model = this.tanks.get(t.id)!;
        const p = this.projected.copy(model.root.position);
        p.y += 2.5;
        p.project(this.camera);
        return {
          id: t.id,
          x: ((p.x + 1) / 2) * this.width,
          y: ((1 - p.y) / 2) * this.height,
          visible: t.alive && this.visible.has(t.id) && Math.abs(p.x) < 1 && Math.abs(p.y) < 1,
        };
      });
      this.onLabels?.(labels);
      this.tactical.animate(state, now);
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    this.flashes = this.flashes.filter((f) => {
      f.life -= dt;
      if (f.life <= 0) {
        this.scene.remove(f.mesh);
        f.mesh.material.dispose();
        return false;
      }
      const progress = 1 - f.life / f.max;
      f.mesh.material.opacity = (f.smoke ? 0.5 : 0.9) * (1 - progress);
      f.mesh.scale.setScalar(f.size * (f.smoke ? 1 + progress * 1.5 : 1 + progress * 0.5));
      if (f.smoke) f.mesh.position.y += dt * 0.9;
      return true;
    });
    this.rings = this.rings.filter((r) => {
      r.life -= dt;
      if (r.life <= 0) {
        this.disposeObject(r.mesh);
        return false;
      }
      const progress = 1 - r.life / r.max;
      r.mesh.scale.setScalar(1 + progress * 4);
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - progress) * 0.65;
      return true;
    });
    this.particles.forEach((p, i) => {
      p.life -= dt;
      p.x += p.vx * dt;
      p.z += p.vz * dt;
      p.y += p.vy * dt;
      p.vy -= 8 * dt;
      const scale = p.size * Math.max(0, p.life / p.max);
      this.dummy.position.set(p.x, Math.max(0.05, p.y), p.z);
      this.dummy.scale.setScalar(scale);
      this.dummy.rotation.set(p.life * 3, p.life * 4, 0);
      this.dummy.updateMatrix();
      this.particleMesh.setMatrixAt(i, this.dummy.matrix);
      this.particleMesh.setColorAt(i, p.color);
    });
    this.particleMesh.count = this.particles.length;
    this.particleMesh.instanceMatrix.needsUpdate = true;
    if (this.particleMesh.instanceColor) this.particleMesh.instanceColor.needsUpdate = true;
    this.renderer.render(this.scene, this.camera);
  };
  private disposeObject(object: THREE.Object3D) {
    this.scene.remove(object);
    object.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.Sprite) {
        if (obj instanceof THREE.Mesh) obj.geometry.dispose();
        const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const mat of materials) {
          for (const value of Object.values(mat))
            if (value instanceof THREE.Texture) value.dispose();
          mat.dispose();
        }
      }
    });
  }
  destroy() {
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.tactical.destroy();
    this.supplies.destroy();
    this.objectives.destroy();
    this.disposeObject(this.scene);
    for (const pool of this.bulletPool.values()) for (const mesh of pool) this.disposeObject(mesh);
    this.bulletPool.clear();
    this.glowTexture.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
