import * as THREE from 'three';
import { HEX_INNER_RATIO, HEX_RADIUS } from '@/types/game';

/**
 * Top cap of the same hex prism as terrain (`CylinderGeometry` + Y rotation π/6),
 * with planar UVs (x,z → u,v) so square PNGs map flush to the hex — no corner drift.
 */
export function createTerrainHexTopGeometry(radius: number): THREE.BufferGeometry {
  const h = 0.0004;
  const cyl = new THREE.CylinderGeometry(radius, radius, h, 6, 1, false);
  cyl.rotateY(Math.PI / 6);

  const pos = cyl.attributes.position;
  const index = cyl.index!;
  let maxY = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    maxY = Math.max(maxY, pos.getY(i));
  }

  const newPositions: number[] = [];
  const newIndex: number[] = [];
  const oldToNew = new Map<number, number>();

  const mapVert = (oldIdx: number): number => {
    let ni = oldToNew.get(oldIdx);
    if (ni !== undefined) return ni;
    ni = newPositions.length / 3;
    oldToNew.set(oldIdx, ni);
    newPositions.push(pos.getX(oldIdx), pos.getY(oldIdx), pos.getZ(oldIdx));
    return ni;
  };

  for (let i = 0; i < index.count; i += 3) {
    const ia = index.getX(i);
    const ib = index.getX(i + 1);
    const ic = index.getX(i + 2);
    const ya = pos.getY(ia);
    const yb = pos.getY(ib);
    const yc = pos.getY(ic);
    if (Math.abs(ya - maxY) < 1e-7 && Math.abs(yb - maxY) < 1e-7 && Math.abs(yc - maxY) < 1e-7) {
      newIndex.push(mapVert(ia), mapVert(ib), mapVert(ic));
    }
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < newPositions.length; i += 3) {
    const x = newPositions[i];
    const z = newPositions[i + 2];
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  const dx = maxX - minX || 1;
  const dz = maxZ - minZ || 1;

  const uvs = new Float32Array((newPositions.length / 3) * 2);
  for (let i = 0; i < newPositions.length / 3; i++) {
    const x = newPositions[i * 3];
    const z = newPositions[i * 3 + 2];
    uvs[i * 2] = (x - minX) / dx;
    uvs[i * 2 + 1] = 1 - (z - minZ) / dz;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(newPositions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(newIndex);
  geo.computeVertexNormals();
  cyl.dispose();
  return geo;
}

/** Matches terrain column radius (flush with hex prism). */
export function defaultHexTopRadius(): number {
  return HEX_RADIUS * HEX_INNER_RATIO;
}

/**
 * Biome paint mesh: a few % wider than the column so the decal overlaps the top rim
 * and never reveals the dark prism sides (fixes black “gaps” inside tiles).
 */
export function defaultBiomePaintRadius(): number {
  return HEX_RADIUS * HEX_INNER_RATIO * 1.035;
}
