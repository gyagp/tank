import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Bake rigid parts into one draw per material, preserving the root's animation transform. */
export function batchRigidParts(root: THREE.Object3D) {
  root.updateWorldMatrix(true, true);
  const inverse = root.matrixWorld.clone().invert();
  const groups = new Map<string, THREE.Mesh[]>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || Array.isArray(object.material)) return;
    if (object.material.transparent || object instanceof THREE.InstancedMesh) return;
    const key = `${object.material.uuid}:${object.castShadow}:${object.receiveShadow}`;
    const group = groups.get(key) || [];
    group.push(object);
    groups.set(key, group);
  });
  for (const parts of groups.values()) {
    if (parts.length < 2) continue;
    const geometries = parts.map((part) => {
      const geometry = part.geometry.index ? part.geometry.toNonIndexed() : part.geometry.clone();
      geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, part.matrixWorld));
      return geometry;
    });
    const merged = mergeGeometries(geometries, false);
    geometries.forEach((geometry) => geometry.dispose());
    if (!merged) continue;
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, parts[0].material);
    mesh.castShadow = parts[0].castShadow;
    mesh.receiveShadow = parts[0].receiveShadow;
    mesh.matrixAutoUpdate = false;
    root.add(mesh);
    for (const part of parts) {
      part.removeFromParent();
      part.geometry.dispose();
    }
  }
}
