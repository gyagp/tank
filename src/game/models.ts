import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { TankClass } from '../../shared/types';
import { batchRigidParts } from './batching';

const mat = (color: number, roughness = 0.8, metalness = 0.2) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness });
export function box(
  parent: THREE.Object3D,
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  material: THREE.Material,
  rounded = false,
) {
  const mesh = new THREE.Mesh(
    rounded ? new RoundedBoxGeometry(w, h, d, 1, 0.08) : new THREE.BoxGeometry(w, h, d),
    material,
  );
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}
export function cylinder(
  parent: THREE.Object3D,
  r1: number,
  r2: number,
  h: number,
  x: number,
  y: number,
  z: number,
  material: THREE.Material,
  segments = 12,
) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, segments), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}
export function makeTank(classId: TankClass, color: number) {
  const root = new THREE.Group(),
    chassis = new THREE.Group(),
    turret = new THREE.Group();
  root.add(chassis, turret);
  const isHeavy = classId === 'bastion',
    isLight = classId === 'ghost',
    scale = isHeavy ? 1.12 : isLight ? 0.86 : 1;
  const armor = mat(isHeavy ? 0x626956 : isLight ? 0x5c6c72 : 0x778169),
    dark = mat(0x262b29),
    metal = mat(0x4b5047, 0.5, 0.65),
    accent = mat(color, 0.5),
    top = mat(isHeavy ? 0x7a816a : isLight ? 0x849397 : 0x939c7c);
  const glow = new THREE.MeshStandardMaterial({
    color: 0xffe3a2,
    emissive: 0xffd17d,
    emissiveIntensity: 1.5,
  });
  for (const side of [-1, 1]) {
    box(chassis, 0.48, 0.57, 2.15, side * 0.83, 0.4, 0, dark, true);
    for (let i = 0; i < 6; i++) {
      const wheel = cylinder(chassis, 0.24, 0.24, 0.51, side * 0.84, 0.41, -0.82 + i * 0.33, metal);
      wheel.rotation.z = Math.PI / 2;
      const hub = cylinder(chassis, 0.1, 0.1, 0.53, side * 0.84, 0.41, -0.82 + i * 0.33, armor, 8);
      hub.rotation.z = Math.PI / 2;
    }
    for (let i = 0; i < 11; i++)
      box(chassis, 0.5, 0.05, 0.13, side * 0.83, 0.71, -0.94 + i * 0.188, metal);
    box(chassis, 0.54, 0.14, 2.22, side * 0.84, 0.83, 0, armor, true);
    box(chassis, 0.35, 0.035, 0.45, side * 0.84, 0.91, 0.5, accent);
    box(chassis, 0.23, 0.12, 0.1, side * 0.76, 0.9, 1.13, glow);
    box(chassis, 0.18, 0.12, 0.1, side * 0.76, 0.6, -1.12, mat(0xa14126));
  }
  box(chassis, 1.37, 0.49, 1.94, 0, 0.65, 0, armor, true);
  const front = box(chassis, 1.3, 0.18, 0.66, 0, 0.93, 0.66, top, true);
  front.rotation.x = 0.16;
  for (let i = 0; i < 7; i++) box(chassis, 0.9, 0.035, 0.055, 0, 0.92, -0.9 + i * 0.07, dark);
  cylinder(turret, 0.55, 0.64, 0.14, 0, 1, 0, metal, 20);
  box(turret, isHeavy ? 1.25 : 1.03, 0.47, 1.12, 0, 1.25, -0.04, armor, true);
  box(turret, 0.82, 0.1, 0.85, 0, 1.53, -0.1, top, true);
  box(turret, 0.12, 0.03, 0.81, 0.28, 1.6, -0.06, accent);
  cylinder(turret, 0.24, 0.24, 0.1, -0.19, 1.63, -0.23, dark, 16);
  cylinder(turret, 0.19, 0.21, 0.07, -0.19, 1.7, -0.23, armor, 16);
  const cannon = cylinder(
    turret,
    isHeavy ? 0.14 : 0.11,
    isHeavy ? 0.16 : 0.13,
    1.55,
    0,
    1.32,
    1.16,
    metal,
  );
  cannon.rotation.x = Math.PI / 2;
  const mantle = cylinder(turret, 0.24, 0.24, 0.32, 0, 1.32, 0.54, armor);
  mantle.rotation.x = Math.PI / 2;
  box(turret, isHeavy ? 0.38 : 0.29, 0.27, 0.38, 0, 1.32, 1.96, dark, true);
  box(turret, 0.15, 0.14, 0.015, 0, 1.32, 2.157, mat(0x101510));
  cylinder(turret, 0.018, 0.028, 0.98, 0.4, 1.92, -0.38, metal, 5);
  box(turret, 0.22, 0.15, 0.28, 0.27, 1.68, 0.15, dark);
  const shield = new THREE.Mesh(
    new THREE.SphereGeometry(1.62, 24, 16),
    new THREE.MeshBasicMaterial({
      color: 0x72e2f0,
      transparent: true,
      opacity: 0.14,
      wireframe: true,
      depthWrite: false,
    }),
  );
  shield.position.y = 0.75;
  shield.scale.y = 0.75;
  shield.visible = false;
  root.add(shield);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(1.25, 1.32, 48),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.045;
  root.add(ring);
  batchRigidParts(chassis);
  batchRigidParts(turret);
  chassis.scale.setScalar(scale);
  turret.scale.setScalar(scale);
  return { root, chassis, turret, shield, ring };
}
