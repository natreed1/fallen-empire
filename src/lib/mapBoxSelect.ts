import * as THREE from 'three';
import type { Unit, City } from '@/types/game';
import {
  tileKey,
  axialToWorld,
  HEX_RADIUS,
  worldToAxial,
} from '@/types/game';
import { unitShownAsGarrisonSprite } from '@/lib/garrison';

const HUMAN_ID = 'player_human';

const _v = new THREE.Vector3();
const _ndc = new THREE.Vector2();
const _raycaster = new THREE.Raycaster();
const _groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.01);

/**
 * Human map stacks whose hex center projects inside the axis-aligned screen rectangle (client / viewport coords).
 */
export function collectHumanStackKeysInScreenRect(
  units: Unit[],
  cities: City[],
  camera: THREE.Camera,
  domRect: DOMRect,
  minClientX: number,
  minClientY: number,
  maxClientX: number,
  maxClientY: number,
): string[] {
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const u of units) {
    if (u.ownerId !== HUMAN_ID || u.hp <= 0 || u.aboardShipId) continue;
    if (unitShownAsGarrisonSprite(u, cities)) continue;
    const k = tileKey(u.q, u.r);
    if (seen.has(k)) continue;
    const [wx, wz] = axialToWorld(u.q, u.r, HEX_RADIUS);
    _v.set(wx, 0.55, wz);
    _v.project(camera);
    const sx = (_v.x * 0.5 + 0.5) * domRect.width + domRect.left;
    const sy = (-_v.y * 0.5 + 0.5) * domRect.height + domRect.top;
    if (sx >= minClientX && sx <= maxClientX && sy >= minClientY && sy <= maxClientY) {
      seen.add(k);
      keys.push(k);
    }
  }
  keys.sort((a, b) => {
    const [aq, ar] = a.split(',').map(Number);
    const [bq, br] = b.split(',').map(Number);
    return aq !== bq ? aq - bq : ar - br;
  });
  return keys;
}

/** Raycast the map ground plane from a client pixel position; returns hex if in bounds. */
export function hexFromClientOnMap(
  clientX: number,
  clientY: number,
  camera: THREE.Camera,
  domElement: HTMLElement,
  mapWidth: number,
  mapHeight: number,
): { q: number; r: number } | null {
  const rect = domElement.getBoundingClientRect();
  const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
  const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1;
  _ndc.set(ndcX, ndcY);
  _raycaster.setFromCamera(_ndc, camera);
  const pt = new THREE.Vector3();
  if (!_raycaster.ray.intersectPlane(_groundPlane, pt)) return null;
  const [q, r] = worldToAxial(pt.x, pt.z, HEX_RADIUS);
  if (q >= 0 && q < mapWidth && r >= 0 && r < mapHeight) return { q, r };
  return null;
}
