import * as THREE from 'three';
import { TEAMS, type GameState } from '../../shared/types';

export class ObjectiveEffects {
  private points = new Map<
    string,
    {
      group: THREE.Group;
      ring: THREE.Mesh;
      disc: THREE.Mesh;
      progress: THREE.Mesh;
      badge: THREE.Sprite;
    }
  >();
  constructor(private scene: THREE.Scene) {}
  sync(state: GameState) {
    for (const p of state.controlPoints) {
      let model = this.points.get(p.id);
      if (!model) {
        const group = new THREE.Group();
        group.position.set(p.x, 0, p.z);
        const mat = (opacity: number) =>
          new THREE.MeshBasicMaterial({
            color: 0xe8ead4,
            transparent: true,
            opacity,
            depthWrite: false,
            toneMapped: false,
            side: THREE.DoubleSide,
          });
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(p.radius - 0.08, p.radius, 64),
          mat(0.9),
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.07;
        const disc = new THREE.Mesh(new THREE.CircleGeometry(p.radius, 48), mat(0.07));
        disc.rotation.x = -Math.PI / 2;
        disc.position.y = 0.06;
        const progress = new THREE.Mesh(
          new THREE.RingGeometry(p.radius + 0.08, p.radius + 0.22, 64),
          mat(1),
        );
        progress.rotation.x = -Math.PI / 2;
        progress.position.y = 0.08;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 128;
        const c = canvas.getContext('2d')!;
        c.fillStyle = '#172a30';
        c.beginPath();
        c.roundRect(10, 10, 108, 108, 24);
        c.fill();
        c.strokeStyle = '#ffffff';
        c.lineWidth = 4;
        c.stroke();
        c.fillStyle = '#ffffff';
        c.font = 'bold 76px Arial';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(p.id, 64, 68);
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        const badge = new THREE.Sprite(
          new THREE.SpriteMaterial({ map: texture, depthWrite: false, toneMapped: false }),
        );
        badge.position.set(0, 1.2, -p.radius + 0.2);
        badge.scale.set(1.25, 1.25, 1);
        group.add(ring, disc, progress, badge);
        this.scene.add(group);
        model = { group, ring, disc, progress, badge };
        this.points.set(p.id, model);
      }
      const color = p.contested ? '#ffdf83' : p.owner ? TEAMS[p.owner].color : '#e8ead4';
      for (const mesh of [model.ring, model.disc])
        (mesh.material as THREE.MeshBasicMaterial).color.set(color);
      model.badge.material.color.set(color);
      (model.progress.material as THREE.MeshBasicMaterial).color.set(
        p.capturing ? TEAMS[p.capturing].color : color,
      );
      model.progress.geometry.setDrawRange(0, Math.floor(p.progress * 64) * 6);
    }
  }
  destroy() {
    for (const { group, ring, disc, progress, badge } of this.points.values()) {
      group.removeFromParent();
      for (const mesh of [ring, disc, progress]) {
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      }
      badge.material.map?.dispose();
      badge.material.dispose();
    }
    this.points.clear();
  }
}
