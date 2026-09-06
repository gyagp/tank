import * as THREE from 'three';
import { PICKUPS, type GameState, type PickupKind } from '../../shared/types';

type SupplyModel = {
  group: THREE.Group;
  core: THREE.Mesh;
  pad: THREE.Mesh;
  beam: THREE.Mesh;
  icon: THREE.Sprite;
  label: THREE.Sprite;
  text: string;
  kind: PickupKind;
};
const material = (color: THREE.ColorRepresentation, opacity = 1) =>
  new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    toneMapped: false,
  });

/** Cached holograms: no lights, post-processing, or geometry churn on replenishment. */
export class SupplyEffects {
  private models = new Map<number, SupplyModel>();
  private textures = new Map<string, THREE.CanvasTexture>();
  private coreGeometry = new THREE.OctahedronGeometry(0.5, 0);
  private padGeometry = new THREE.PlaneGeometry(2.5, 2.5);
  private beamGeometry = new THREE.CylinderGeometry(0.42, 0.8, 3.4, 12, 1, true);
  constructor(private scene: THREE.Scene) {}
  private texture(key: string, draw: (c: CanvasRenderingContext2D) => void) {
    let texture = this.textures.get(key);
    if (!texture) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 256;
      draw(canvas.getContext('2d')!);
      texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      this.textures.set(key, texture);
    }
    return texture;
  }
  private iconTexture(kind: PickupKind) {
    return this.texture(kind, (c) => {
      const color = PICKUPS[kind].color;
      c.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i - Math.PI / 6;
        const x = 128 + Math.cos(a) * 108,
          y = 128 + Math.sin(a) * 108;
        if (i) c.lineTo(x, y);
        else c.moveTo(x, y);
      }
      c.closePath();
      c.fillStyle = '#182b30ee';
      c.fill();
      c.strokeStyle = color;
      c.lineWidth = 8;
      c.shadowColor = color;
      c.shadowBlur = 17;
      c.stroke();
      c.shadowBlur = 0;
      c.fillStyle = '#ffffff';
      c.font = 'bold 116px Arial';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(PICKUPS[kind].symbol, 128, 134);
    });
  }
  private create(kind: PickupKind) {
    const group = new THREE.Group(),
      color = PICKUPS[kind].color;
    const core = new THREE.Mesh(this.coreGeometry, material(color));
    const padMat = material(color, 0.9);
    padMat.map = this.texture('pad', (c) => {
      c.fillStyle = '#15282a99';
      c.beginPath();
      c.arc(128, 128, 100, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = '#fff';
      c.lineWidth = 4;
      c.beginPath();
      c.arc(128, 128, 99, 0, Math.PI * 2);
      c.stroke();
      for (let i = 0; i < 8; i++) {
        c.lineWidth = 10;
        c.beginPath();
        c.arc(128, 128, 116, (i * Math.PI) / 4, (i * Math.PI) / 4 + 0.45);
        c.stroke();
      }
      c.lineWidth = 2;
      c.beginPath();
      c.arc(128, 128, 74, 0, Math.PI * 2);
      c.stroke();
    });
    const pad = new THREE.Mesh(this.padGeometry, padMat);
    pad.rotation.x = -Math.PI / 2;
    pad.position.y = 0.04;
    const beamMat = material(color, 0.44);
    beamMat.side = THREE.DoubleSide;
    beamMat.map = this.texture('beam', (c) => {
      const gradient = c.createLinearGradient(0, 0, 0, 256);
      gradient.addColorStop(0, '#ffffff00');
      gradient.addColorStop(0.6, '#ffffff28');
      gradient.addColorStop(1, '#ffffffbb');
      c.fillStyle = gradient;
      c.fillRect(0, 0, 256, 256);
    });
    const beam = new THREE.Mesh(this.beamGeometry, beamMat);
    beam.position.y = 1.75;
    const icon = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.iconTexture(kind),
        depthWrite: false,
        toneMapped: false,
      }),
    );
    icon.scale.set(1.3, 1.3, 1);
    icon.position.y = 2.8;
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 96;
    const label = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: new THREE.CanvasTexture(canvas),
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    label.material.map!.colorSpace = THREE.SRGBColorSpace;
    label.scale.set(6.4, 1.3, 1);
    label.position.y = 3.9;
    label.visible = false;
    group.add(core, pad, beam, icon, label);
    this.scene.add(group);
    return { group, core, pad, beam, icon, label, kind, text: '' };
  }
  private setLabel(model: SupplyModel, text: string) {
    if (model.text === text) return;
    model.text = text;
    const texture = model.label.material.map!;
    const c = (texture.image as HTMLCanvasElement).getContext('2d')!;
    c.clearRect(0, 0, 512, 96);
    c.fillStyle = '#112228e8';
    c.beginPath();
    c.roundRect(2, 3, 508, 86, 12);
    c.fill();
    c.fillStyle = PICKUPS[model.kind].color;
    c.fillRect(5, 20, 6, 50);
    c.fillStyle = '#fff';
    c.font = '600 40px "Noto Sans SC", sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(text, 256, 48, 474);
    texture.needsUpdate = true;
  }
  sync(state: GameState, playerId: string) {
    const me = state.tanks.find((t) => t.id === playerId);
    const nearby = new Set(
      me
        ? [...state.pickups]
            .sort((a, b) => Math.hypot(a.x - me.x, a.z - me.z) - Math.hypot(b.x - me.x, b.z - me.z))
            .slice(0, 2)
            .filter((p) => Math.hypot(p.x - me.x, p.z - me.z) < 9)
            .map((p) => p.id)
        : [],
    );
    for (const p of state.pickups) {
      let m = this.models.get(p.id);
      if (!m) {
        m = this.create(p.kind);
        this.models.set(p.id, m);
      }
      if (m.kind !== p.kind) {
        m.kind = p.kind;
        for (const mesh of [m.core, m.pad, m.beam])
          (mesh.material as THREE.MeshBasicMaterial).color.set(PICKUPS[p.kind].color);
        m.icon.material.map = this.iconTexture(p.kind);
      }
      m.group.position.set(p.x, 0, p.z);
      m.core.visible = m.beam.visible = m.icon.visible = p.active;
      (m.pad.material as THREE.MeshBasicMaterial).opacity = p.active ? 0.9 : 0.25;
      m.label.visible = nearby.has(p.id);
      if (m.label.visible)
        this.setLabel(
          m,
          p.active
            ? PICKUPS[p.kind].name
            : `补充中 · ${Math.max(1, Math.ceil(p.respawnAt - state.time))} 秒`,
        );
    }
    for (const [id, m] of this.models)
      if (!state.pickups.some((p) => p.id === id)) {
        this.dispose(m);
        this.models.delete(id);
      }
  }
  animate(now: number, reduced: boolean) {
    for (const [id, m] of this.models) {
      const phase = now * 0.0018 + id * 1.7;
      m.core.rotation.set(0.3, reduced ? 0 : phase, 0.2);
      m.core.position.y = 1.1 + (reduced ? 0 : Math.sin(phase) * 0.18);
      m.icon.position.y = 2.8 + (reduced ? 0 : Math.sin(phase) * 0.12);
      if (m.beam.visible)
        (m.beam.material as THREE.MeshBasicMaterial).opacity =
          0.38 + (reduced ? 0 : Math.sin(phase) * 0.08);
    }
  }
  private dispose(m: SupplyModel) {
    m.group.removeFromParent();
    for (const mesh of [m.core, m.pad, m.beam]) (mesh.material as THREE.Material).dispose();
    m.icon.material.dispose();
    m.label.material.map?.dispose();
    m.label.material.dispose();
  }
  destroy() {
    for (const m of this.models.values()) this.dispose(m);
    this.models.clear();
    this.textures.forEach((t) => t.dispose());
    this.textures.clear();
    this.coreGeometry.dispose();
    this.padGeometry.dispose();
    this.beamGeometry.dispose();
  }
}
