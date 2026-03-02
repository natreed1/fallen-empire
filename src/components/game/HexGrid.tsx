'use client';

import { useMemo, useRef, useEffect } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { useGameStore } from '@/store/useGameStore';
import {
  Biome, Tile, City, Unit, Hero, ConstructionSite, WallSection, RoadConstructionSite,
  BuildingType,
  WeatherEventType,
  BIOME_COLORS, BIOME_COLORS_DARK, ROAD_COLOR, RUINS_COLOR,
  MOUNTAIN_SNOW_COLOR, PLAYER_COLORS,
  HEX_RADIUS, HEX_INNER_RATIO, axialToWorld, tileKey,
  ANCIENT_CITY_COLOR, GOLD_MINE_DEPOSIT_COLOR, QUARRY_DEPOSIT_COLOR,
} from '@/types/game';

const HEX_SEGMENTS = 6;
const UNIT_HEIGHT = 1.0;

// ─── Sprite Texture Loader ──────────────────────────────────────────
// Loads all game sprite textures once with nearest-neighbor filtering for pixel art crispness.
//
// PNG requirements for correct display:
// - RGBA with transparency (straight/non-premultiplied alpha)
// - Power-of-two dimensions recommended (e.g. 64×64)
// - Crisp pixel edges; no anti-aliasing on pixel boundaries
// Texture loader uses premultiplyAlpha: false — PNGs must NOT be premultiplied.

const SPRITE_PATHS: Record<string, string> = {
  // Units
  infantry: '/sprites/units/infantry.png',
  cavalry:  '/sprites/units/cavalry.png',
  archer:   '/sprites/units/archer.png',
  builder:  '/sprites/units/builder.png',
  // Buildings
  farm:        '/sprites/buildings/farm.png',
  factory:     '/sprites/buildings/factory.png',
  city_center: '/sprites/buildings/silo.png',
  barracks:    '/sprites/buildings/barracks.png',
  academy:     '/sprites/buildings/academy.png',
  market:      '/sprites/buildings/market.png',
  quarry:   '/sprites/buildings/quarry.png',
  mine:     '/sprites/buildings/mine.png',
  gold_mine: '/sprites/buildings/mine.png', // reuse mine sprite for now
  // Entities
  city:     '/sprites/entities/city.png',
  village:  '/sprites/entities/village.png',
  hero:     '/sprites/entities/hero.png',
  // Overlays (pixel art, tileable)
  road:     '/sprites/overlays/road.png',
};

const textureCache = new Map<string, THREE.Texture>();
const textureLoader = new THREE.TextureLoader();

function getSpriteTexture(key: string): THREE.Texture {
  if (textureCache.has(key)) return textureCache.get(key)!;
  const path = SPRITE_PATHS[key];
  if (!path) {
    const fallback = new THREE.Texture();
    textureCache.set(key, fallback);
    return fallback;
  }
  const tex = textureLoader.load(path);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.anisotropy = 1;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.premultiplyAlpha = false;
  textureCache.set(key, tex);
  return tex;
}

function useGameTextures(keys: string[]): Record<string, THREE.Texture> {
  return useMemo(() => {
    const map: Record<string, THREE.Texture> = {};
    for (const key of keys) {
      map[key] = getSpriteTexture(key);
    }
    return map;
  }, [keys.join(',')]);
}

function makeHexGeo(radius: number, height: number): THREE.CylinderGeometry {
  const geo = new THREE.CylinderGeometry(radius, radius, height, HEX_SEGMENTS);
  geo.rotateY(Math.PI / 6);
  return geo;
}

// ─── Terrain Layer ─────────────────────────────────────────────────

function TerrainLayer({ tiles, biome }: { tiles: Tile[]; biome: Biome }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const count = tiles.length;
  const geometry = useMemo(() => makeHexGeo(HEX_RADIUS * HEX_INNER_RATIO, UNIT_HEIGHT), []);

  // MeshLambertMaterial is cheaper and doesn't crush darks on side faces.
  // Emissive ensures hex sides are never pitch-black at any camera angle.
  const material = useMemo(() => {
    const baseColor = new THREE.Color(BIOME_COLORS[biome]);
    return new THREE.MeshLambertMaterial({
      vertexColors: true,
      emissive: baseColor,
      emissiveIntensity: 0.15,
    });
  }, [biome]);

  useEffect(() => {
    if (!meshRef.current || count === 0) return;
    const mesh = meshRef.current;
    const dummy = new THREE.Object3D();
    const base = new THREE.Color(BIOME_COLORS[biome]);
    const dark = new THREE.Color(BIOME_COLORS_DARK[biome]);
    const colors = new Float32Array(count * 3);

    tiles.forEach((tile, i) => {
      const [x, z] = axialToWorld(tile.q, tile.r, HEX_RADIUS);
      dummy.position.set(x, tile.height / 2, z);
      dummy.scale.set(1, Math.max(0.05, tile.height / UNIT_HEIGHT), 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);

      // Gentle variation: only 30% toward the dark color at most
      const t = (tile.elevation + 1) / 2;
      const c = base.clone().lerp(dark, (1.0 - t) * 0.3);
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
    mesh.instanceColor.needsUpdate = true;
  }, [tiles, biome, count, geometry]);

  if (count === 0) return null;
  return <instancedMesh ref={meshRef} args={[geometry, material, count]} raycast={() => null} />;
}

// ─── Mountain Snow ─────────────────────────────────────────────────

function MountainSnowLayer({ tiles }: { tiles: Tile[] }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const snowTiles = useMemo(() => {
    if (tiles.length === 0) return [];
    const sorted = [...tiles].sort((a, b) => b.height - a.height);
    return sorted.slice(0, Math.floor(sorted.length * 0.4));
  }, [tiles]);
  const geometry = useMemo(() => makeHexGeo(HEX_RADIUS * HEX_INNER_RATIO * 0.65, 0.15), []);
  const material = useMemo(() => new THREE.MeshLambertMaterial({ color: MOUNTAIN_SNOW_COLOR, emissive: MOUNTAIN_SNOW_COLOR, emissiveIntensity: 0.2 }), []);

  useEffect(() => {
    if (!meshRef.current || snowTiles.length === 0) return;
    const mesh = meshRef.current;
    const dummy = new THREE.Object3D();
    snowTiles.forEach((tile, i) => {
      const [x, z] = axialToWorld(tile.q, tile.r, HEX_RADIUS);
      dummy.position.set(x, tile.height + 0.08, z);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [snowTiles]);

  if (snowTiles.length === 0) return null;
  return <instancedMesh ref={meshRef} args={[geometry, material, snowTiles.length]} castShadow raycast={() => null} />;
}

// ─── Generic Overlay ───────────────────────────────────────────────

function OverlayLayer({ tiles, color, yOffset, radiusScale = 0.5, height = 0.07 }: {
  tiles: Tile[]; color: string; yOffset: number; radiusScale?: number; height?: number;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const count = tiles.length;
  const geometry = useMemo(() => makeHexGeo(HEX_RADIUS * radiusScale, height), [radiusScale, height]);
  const material = useMemo(() => new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.1 }), [color]);

  useEffect(() => {
    if (!meshRef.current || count === 0) return;
    const mesh = meshRef.current;
    const dummy = new THREE.Object3D();
    tiles.forEach((tile, i) => {
      const [x, z] = axialToWorld(tile.q, tile.r, HEX_RADIUS);
      dummy.position.set(x, tile.height + yOffset, z);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [tiles, yOffset, count]);

  if (count === 0) return null;
  return <instancedMesh ref={meshRef} args={[geometry, material, count]} raycast={() => null} />;
}

// Road overlay — solid color so roads are always visible (logistics connections)
function RoadOverlay({ tiles }: { tiles: Tile[] }) {
  return (
    <OverlayLayer tiles={tiles} color={ROAD_COLOR} yOffset={0.05} radiusScale={0.58} height={0.07} />
  );
}

// Road construction in progress — amber overlay so work sites are clearly visible
const ROAD_CONSTRUCTION_COLOR = '#c9a227';
function RoadConstructionOverlay({ sites, tiles }: { sites: RoadConstructionSite[]; tiles: Map<string, Tile> }) {
  const roadTiles = useMemo(() => {
    const out: Tile[] = [];
    for (const site of sites) {
      const t = tiles.get(tileKey(site.q, site.r));
      if (t) out.push(t);
    }
    return out;
  }, [sites, tiles]);
  if (roadTiles.length === 0) return null;
  return (
    <OverlayLayer tiles={roadTiles} color={ROAD_CONSTRUCTION_COLOR} yOffset={0.06} radiusScale={0.58} height={0.06} />
  );
}

// ─── Village Sprites ────────────────────────────────────────────────

function VillageLayer({ tiles }: { tiles: Tile[] }) {
  const tex = useMemo(() => getSpriteTexture('village'), []);

  if (tiles.length === 0) return null;
  return (
    <group>
      {tiles.map(tile => {
        const [x, z] = axialToWorld(tile.q, tile.r, HEX_RADIUS);
        return (
          <sprite key={tileKey(tile.q, tile.r)} position={[x, tile.height + 0.5, z]} scale={[1.2, 1.2, 1]} raycast={() => null}>
            <spriteMaterial map={tex} transparent alphaTest={0.05} depthWrite={false} />
          </sprite>
        );
      })}
    </group>
  );
}

// ─── Resource Deposit Markers ───────────────────────────────────────

function DepositMarkers({ tiles }: { tiles: Map<string, Tile> }) {
  const quarryRef = useRef<THREE.InstancedMesh>(null);
  const mineRef = useRef<THREE.InstancedMesh>(null);

  const { quarryTiles, mineTiles, goldMineTiles, ancientCityTiles } = useMemo(() => {
    const q: Tile[] = [];
    const m: Tile[] = [];
    const g: Tile[] = [];
    const a: Tile[] = [];
    Array.from(tiles.values()).forEach(tile => {
      if (tile.hasQuarryDeposit) q.push(tile);
      if (tile.hasMineDeposit) m.push(tile);
      if (tile.hasGoldMineDeposit) g.push(tile);
      if (tile.hasAncientCity) a.push(tile);
    });
    return { quarryTiles: q, mineTiles: m, goldMineTiles: g, ancientCityTiles: a };
  }, [tiles]);

  const geometry = useMemo(() => makeHexGeo(HEX_RADIUS * 0.35, 0.08), []);
  const quarryMat = useMemo(() => new THREE.MeshBasicMaterial({
    color: QUARRY_DEPOSIT_COLOR, transparent: true, opacity: 0.75, depthWrite: false,
  }), []);
  const mineMat = useMemo(() => new THREE.MeshBasicMaterial({
    color: '#b45309', transparent: true, opacity: 0.75, depthWrite: false,
  }), []);
  const goldMineMat = useMemo(() => new THREE.MeshBasicMaterial({
    color: GOLD_MINE_DEPOSIT_COLOR, transparent: true, opacity: 0.7, depthWrite: false,
  }), []);
  const ancientCityMat = useMemo(() => new THREE.MeshBasicMaterial({
    color: ANCIENT_CITY_COLOR, transparent: true, opacity: 0.85, depthWrite: false,
  }), []);

  useEffect(() => {
    if (!quarryRef.current || quarryTiles.length === 0) return;
    const mesh = quarryRef.current;
    const dummy = new THREE.Object3D();
    quarryTiles.forEach((tile, i) => {
      const [x, z] = axialToWorld(tile.q, tile.r, HEX_RADIUS);
      dummy.position.set(x + 0.4, tile.height + 0.06, z + 0.3);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [quarryTiles]);

  useEffect(() => {
    if (!mineRef.current || mineTiles.length === 0) return;
    const mesh = mineRef.current;
    const dummy = new THREE.Object3D();
    mineTiles.forEach((tile, i) => {
      const [x, z] = axialToWorld(tile.q, tile.r, HEX_RADIUS);
      dummy.position.set(x + 0.4, tile.height + 0.06, z + 0.3);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [mineTiles]);

  const goldMineRef = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    if (!goldMineRef.current || goldMineTiles.length === 0) return;
    const mesh = goldMineRef.current;
    const dummy = new THREE.Object3D();
    goldMineTiles.forEach((tile, i) => {
      const [x, z] = axialToWorld(tile.q, tile.r, HEX_RADIUS);
      dummy.position.set(x + 0.4, tile.height + 0.06, z + 0.3);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [goldMineTiles]);

  const ancientCityRef = useRef<THREE.InstancedMesh>(null);
  const ancientCityGeo = useMemo(() => makeHexGeo(HEX_RADIUS * 0.5, 0.12), []);
  useEffect(() => {
    if (!ancientCityRef.current || ancientCityTiles.length === 0) return;
    const mesh = ancientCityRef.current;
    const dummy = new THREE.Object3D();
    ancientCityTiles.forEach((tile, i) => {
      const [x, z] = axialToWorld(tile.q, tile.r, HEX_RADIUS);
      dummy.position.set(x, tile.height + 0.08, z);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [ancientCityTiles]);

  return (
    <group>
      {quarryTiles.length > 0 && (
        <instancedMesh ref={quarryRef} args={[geometry, quarryMat, quarryTiles.length]} />
      )}
      {mineTiles.length > 0 && (
        <instancedMesh ref={mineRef} args={[geometry, mineMat, mineTiles.length]} />
      )}
      {goldMineTiles.length > 0 && (
        <instancedMesh ref={goldMineRef} args={[geometry, goldMineMat, goldMineTiles.length]} />
      )}
      {ancientCityTiles.length > 0 && (
        <instancedMesh ref={ancientCityRef} args={[ancientCityGeo, ancientCityMat, ancientCityTiles.length]} />
      )}
    </group>
  );
}

// ─── Territory Overlay ─────────────────────────────────────────────

function TerritoryOverlay({ playerColor, tileKeys, tiles }: {
  playerColor: string; tileKeys: string[]; tiles: Map<string, Tile>;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const validTiles = useMemo(() => {
    return tileKeys.map(k => tiles.get(k)).filter((t): t is Tile => !!t);
  }, [tileKeys, tiles]);

  const geometry = useMemo(() => makeHexGeo(HEX_RADIUS * 0.98, 0.04), []);
  const material = useMemo(() => new THREE.MeshBasicMaterial({
    color: playerColor, transparent: true, opacity: 0.35,
    depthWrite: false,
  }), [playerColor]);

  useEffect(() => {
    if (!meshRef.current || validTiles.length === 0) return;
    const mesh = meshRef.current;
    const dummy = new THREE.Object3D();
    validTiles.forEach((tile, i) => {
      const [x, z] = axialToWorld(tile.q, tile.r, HEX_RADIUS);
      dummy.position.set(x, tile.height + 0.02, z);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [validTiles]);

  if (validTiles.length === 0) return null;
  return <instancedMesh ref={meshRef} args={[geometry, material, validTiles.length]} />;
}

// ─── City Sprites ───────────────────────────────────────────────────

function CityMarkers({ cities, tiles }: { cities: City[]; tiles: Map<string, Tile> }) {
  const tex = useMemo(() => getSpriteTexture('city'), []);

  if (cities.length === 0) return null;
  return (
    <group>
      {cities.map(city => {
        const tile = tiles.get(tileKey(city.q, city.r));
        const h = tile?.height ?? 0.3;
        const [x, z] = axialToWorld(city.q, city.r, HEX_RADIUS);
        const isHuman = city.ownerId.includes('human');
        return (
          <sprite key={city.id} position={[x, h + 0.65, z]} scale={[1.6, 1.6, 1]} raycast={() => null}>
            <spriteMaterial
              map={tex} transparent alphaTest={0.05}
              color={isHuman ? '#ffffff' : '#ff9999'}
              depthWrite={false}
            />
          </sprite>
        );
      })}
    </group>
  );
}

// ─── Building Sprites ───────────────────────────────────────────────

const BUILDING_SPRITE_SCALE: Record<BuildingType, [number, number]> = {
  city_center: [1.0, 1.3],
  farm:        [1.2, 1.2],
  factory:     [1.1, 1.1],
  barracks:    [1.1, 1.1],
  academy:     [0.9, 1.2],
  market:      [1.2, 1.2],
  quarry:      [1.0, 1.0],
  mine:        [1.0, 1.0],
  gold_mine:   [1.0, 1.0],
};

const BUILDING_Y_OFFSET: Record<BuildingType, number> = {
  city_center: 0.50,
  farm:        0.45,
  factory:     0.40,
  barracks:    0.40,
  academy:     0.55,
  market:      0.45,
  quarry:      0.40,
  mine:        0.40,
  gold_mine:   0.40,
};

function BuildingMarkers({ cities, tiles }: { cities: City[]; tiles: Map<string, Tile> }) {
  const textures = useGameTextures(['farm', 'factory', 'city_center', 'barracks', 'academy', 'market', 'quarry', 'mine', 'gold_mine']);

  const allBuildings = useMemo(() => {
    const result: { key: string; type: BuildingType; q: number; r: number; x: number; y: number; z: number }[] = [];
    for (const city of cities) {
      for (const b of city.buildings) {
        const tile = tiles.get(tileKey(b.q, b.r));
        const h = tile?.height ?? 0.3;
        const [x, z] = axialToWorld(b.q, b.r, HEX_RADIUS);
        const yOff = BUILDING_Y_OFFSET[b.type] ?? 0.4;
        result.push({
          key: `${city.id}-${b.type}-${b.q},${b.r}`,
          type: b.type, q: b.q, r: b.r,
          x, y: h + yOff, z,
        });
      }
    }
    return result;
  }, [cities, tiles]);

  if (allBuildings.length === 0) return null;
  return (
    <group>
      {allBuildings.map(b => {
        const tex = textures[b.type];
        const [sx, sy] = BUILDING_SPRITE_SCALE[b.type] ?? [1.0, 1.0];
        return (
          <sprite key={b.key} position={[b.x, b.y, b.z]} scale={[sx, sy, 1]} raycast={() => null}>
            <spriteMaterial map={tex} transparent alphaTest={0.05} depthWrite={false} />
          </sprite>
        );
      })}
    </group>
  );
}

// ─── Unit HP Bars (floating above each army stack) ────────────────

function UnitHpBars({ units, tiles }: { units: Unit[]; tiles: Map<string, Tile> }) {
  const stacks = useMemo(() => {
    const byHex: Record<string, Unit[]> = {};
    for (const u of units) {
      if (u.hp <= 0) continue;
      const key = tileKey(u.q, u.r);
      if (!byHex[key]) byHex[key] = [];
      byHex[key].push(u);
    }
    return Object.entries(byHex).map(([key, stackUnits]) => {
      const [q, r] = key.split(',').map(Number);
      let totalHp = 0, totalMaxHp = 0;
      for (const u of stackUnits) { totalHp += u.hp; totalMaxHp += u.maxHp; }
      const isHuman = stackUnits[0].ownerId.includes('human');
      return { key, q, r, totalHp, totalMaxHp, count: stackUnits.length, isHuman };
    });
  }, [units]);

  if (stacks.length === 0) return null;

  return (
    <group>
      {stacks.map(stack => {
        const tile = tiles.get(tileKey(stack.q, stack.r));
        const h = tile?.height ?? 0.3;
        const [x, z] = axialToWorld(stack.q, stack.r, HEX_RADIUS);
        const ratio = stack.totalMaxHp > 0 ? stack.totalHp / stack.totalMaxHp : 0;
        const barColor = ratio > 0.6 ? '#22c55e' : ratio > 0.3 ? '#eab308' : '#ef4444';

        return (
          <group key={stack.key} position={[x, h + 1.15, z]}>
            <Html transform sprite scale={0.4}
              pointerEvents="none"
              style={{ pointerEvents: 'none', userSelect: 'none' }}>
              <div style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1px',
                whiteSpace: 'nowrap',
              }}>
                <span style={{
                  fontSize: '11px', fontWeight: 800, fontFamily: 'monospace',
                  color: barColor, textShadow: '0 0 4px #000, 0 0 4px #000, 0 0 2px #000',
                  lineHeight: 1,
                }}>
                  {stack.totalHp} HP
                </span>
                <div style={{
                  width: '40px', height: '5px', background: '#111', borderRadius: '3px',
                  overflow: 'hidden', border: '1px solid rgba(255,255,255,0.2)',
                }}>
                  <div style={{
                    width: `${ratio * 100}%`, height: '100%',
                    background: barColor, borderRadius: '3px',
                  }} />
                </div>
              </div>
            </Html>
          </group>
        );
      })}
    </group>
  );
}

// ─── Unit Sprites ──────────────────────────────────────────────────

const UNIT_SPRITE_KEY: Record<string, string> = {
  infantry: 'infantry',
  cavalry: 'cavalry',
  ranged: 'archer',
  archer: 'archer',
  builder: 'builder',
  trebuchet: 'archer',      // placeholder until siege sprite exists
  battering_ram: 'infantry', // placeholder until siege sprite exists
};

const UNIT_SPRITE_SCALE: Record<string, [number, number]> = {
  infantry: [1.1, 1.1],
  cavalry:  [1.3, 1.3],
  ranged:   [1.1, 1.1],
  archer:   [1.1, 1.1],
  builder:  [1.0, 1.0],
  trebuchet: [1.2, 1.2],
  battering_ram: [1.2, 1.2],
};

function UnitMarkers({ units, tiles }: { units: Unit[]; tiles: Map<string, Tile> }) {
  const textures = useGameTextures(['infantry', 'cavalry', 'archer', 'builder']);

  const positioned = useMemo(() => {
    const hexCount = new Map<string, number>();
    return units.filter(u => u.hp > 0).map(u => {
      const key = tileKey(u.q, u.r);
      const idx = hexCount.get(key) ?? 0;
      hexCount.set(key, idx + 1);

      const tile = tiles.get(key);
      const h = tile?.height ?? 0.3;
      const [x, z] = axialToWorld(u.q, u.r, HEX_RADIUS);
      const offset = idx * 0.18;

      let tintColor = '#ffffff';
      if (u.status === 'starving') tintColor = '#cc6600';
      else if (u.status === 'fighting') tintColor = '#ff8888';
      else if (!u.ownerId.includes('human')) tintColor = '#ff7777';

      return {
        id: u.id, type: u.type,
        x: x + offset * 0.3,
        y: h + 0.55,
        z: z - offset * 0.2,
        tint: tintColor,
      };
    });
  }, [units, tiles]);

  if (positioned.length === 0) return null;
  return (
    <group>
      {positioned.map(u => {
        const spriteKey = UNIT_SPRITE_KEY[u.type] ?? u.type;
        const tex = textures[spriteKey];
        const [sx, sy] = UNIT_SPRITE_SCALE[u.type] ?? [1.0, 1.0];
        return (
          <sprite key={u.id} position={[u.x, u.y, u.z]} scale={[sx, sy, 1]} raycast={() => null}>
            <spriteMaterial map={tex} transparent alphaTest={0.05} color={u.tint} depthWrite={false} />
          </sprite>
        );
      })}
    </group>
  );
}

// ─── Hero Sprites ──────────────────────────────────────────────────

function HeroMarkers({ heroes, tiles }: { heroes: Hero[]; tiles: Map<string, Tile> }) {
  const tex = useMemo(() => getSpriteTexture('hero'), []);

  if (heroes.length === 0) return null;
  return (
    <group>
      {heroes.map(h => {
        const tile = tiles.get(tileKey(h.q, h.r));
        const ht = tile?.height ?? 0.3;
        const [x, z] = axialToWorld(h.q, h.r, HEX_RADIUS);
        return (
          <sprite key={h.id} position={[x, ht + 0.75, z]} scale={[1.2, 1.2, 1]} raycast={() => null}>
            <spriteMaterial map={tex} transparent alphaTest={0.05} depthWrite={false} />
          </sprite>
        );
      })}
    </group>
  );
}

// ─── Construction Site Markers ───────────────────────────────────────

function ConstructionMarkers({ sites, tiles }: { sites: ConstructionSite[]; tiles: Map<string, Tile> }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const geometry = useMemo(() => {
    const geo = new THREE.BoxGeometry(0.35, 0.1, 0.35);
    return geo;
  }, []);
  const material = useMemo(() => new THREE.MeshLambertMaterial({
    color: '#cc8800', emissive: '#cc8800', emissiveIntensity: 0.4,
    transparent: true, opacity: 0.7,
  }), []);

  useEffect(() => {
    if (!meshRef.current || sites.length === 0) return;
    const mesh = meshRef.current;
    const dummy = new THREE.Object3D();
    const time = Date.now() * 0.003;
    sites.forEach((site, i) => {
      const tile = tiles.get(tileKey(site.q, site.r));
      const h = tile?.height ?? 0.3;
      const [x, z] = axialToWorld(site.q, site.r, HEX_RADIUS);
      const bob = Math.sin(time + i) * 0.05;
      dummy.position.set(x, h + 0.25 + bob, z);
      dummy.rotation.set(0, time * 0.5, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [sites, tiles]);

  if (sites.length === 0) return null;
  return <instancedMesh ref={meshRef} args={[geometry, material, sites.length]} />;
}

// ─── Move Range Highlight ───────────────────────────────────────────

const MOVE_RADIUS = 10;

function MoveRangeOverlay({ fromQ, fromR, tiles }: {
  fromQ: number; fromR: number; tiles: Map<string, Tile>;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  const reachableTiles = useMemo(() => {
    const result: Tile[] = [];
    for (let dq = -MOVE_RADIUS; dq <= MOVE_RADIUS; dq++) {
      for (let dr = -MOVE_RADIUS; dr <= MOVE_RADIUS; dr++) {
        const dist = (Math.abs(dq) + Math.abs(dq + dr) + Math.abs(dr)) / 2;
        if (dist > MOVE_RADIUS || dist === 0) continue;
        const tq = fromQ + dq;
        const tr = fromR + dr;
        const tile = tiles.get(tileKey(tq, tr));
        if (tile && tile.biome !== 'water') {
          result.push(tile);
        }
      }
    }
    return result;
  }, [fromQ, fromR, tiles]);

  const geometry = useMemo(() => makeHexGeo(HEX_RADIUS * HEX_INNER_RATIO * 0.95, 0.03), []);
  const material = useMemo(() => new THREE.MeshBasicMaterial({
    color: '#44ff88', transparent: true, opacity: 0.18, depthWrite: false,
  }), []);

  useEffect(() => {
    if (!meshRef.current || reachableTiles.length === 0) return;
    const mesh = meshRef.current;
    const dummy = new THREE.Object3D();
    reachableTiles.forEach((tile, i) => {
      const [x, z] = axialToWorld(tile.q, tile.r, HEX_RADIUS);
      dummy.position.set(x, tile.height + 0.05, z);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.count = reachableTiles.length;
  }, [reachableTiles]);

  if (reachableTiles.length === 0) return null;
  return <instancedMesh ref={meshRef} args={[geometry, material, Math.max(1, reachableTiles.length)]} renderOrder={5} />;
}

// ─── Deposit Highlight (Mine/Quarry build mode) ─────────────────────

function DepositHighlightOverlay({ tiles, cities, constructions, depositType }: {
  tiles: Map<string, Tile>;
  cities: City[];
  constructions: ConstructionSite[];
  depositType: 'mine' | 'quarry' | 'gold_mine';
}) {
  const hexes = useMemo(() => {
    const result: Tile[] = [];
    const hasBuilding = (q: number, r: number) =>
      cities.some(c => c.buildings.some(b => tileKey(b.q, b.r) === tileKey(q, r)));
    const hasConstruction = (q: number, r: number) =>
      constructions.some(cs => cs.q === q && cs.r === r);
    tiles.forEach(tile => {
      if (tile.biome === 'water') return;
      if (depositType !== 'gold_mine' && tile.biome === 'mountain') return;
      const match = depositType === 'mine' ? tile.hasMineDeposit : depositType === 'quarry' ? tile.hasQuarryDeposit : tile.hasGoldMineDeposit;
      if (!match || hasBuilding(tile.q, tile.r) || hasConstruction(tile.q, tile.r)) return;
      result.push(tile);
    });
    return result;
  }, [tiles, cities, constructions, depositType]);

  const highlightColor = depositType === 'mine' ? '#b45309' : depositType === 'quarry' ? QUARRY_DEPOSIT_COLOR : GOLD_MINE_DEPOSIT_COLOR;
  const geometry = useMemo(() => makeHexGeo(HEX_RADIUS * HEX_INNER_RATIO * 0.92, 0.08), []);
  const material = useMemo(() => new THREE.MeshBasicMaterial({
    color: highlightColor,
    transparent: true,
    opacity: 0.6,
    depthWrite: false,
  }), [depositType]);

  if (hexes.length === 0) return null;
  return (
    <group>
      {hexes.map(tile => {
        const [x, z] = axialToWorld(tile.q, tile.r, HEX_RADIUS);
        const h = tile.height ?? 0.3;
        return (
          <mesh key={tileKey(tile.q, tile.r)} position={[x, h + 0.08, z]} rotation={[-Math.PI / 2, 0, Math.PI / 6]} geometry={geometry} material={material} />
        );
      })}
    </group>
  );
}

// ─── Road Path Preview (dotted line between hexes) ───────────────────

function RoadPathOverlay({ path, tiles }: { path: { q: number; r: number }[]; tiles: Map<string, Tile> }) {
  if (path.length === 0) return null;

  const geometry = useMemo(() => makeHexGeo(HEX_RADIUS * HEX_INNER_RATIO * 0.9, 0.06), []);
  const material = useMemo(() => new THREE.MeshBasicMaterial({
    color: 0xd0c4a8,
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
  }), []);

  const linePoints = useMemo(() => {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < path.length; i++) {
      const [x, z] = axialToWorld(path[i].q, path[i].r, HEX_RADIUS);
      const tile = tiles.get(tileKey(path[i].q, path[i].r));
      const h = tile?.height ?? 0.3;
      pts.push(new THREE.Vector3(x, h + 0.1, z));
    }
    return pts;
  }, [path, tiles]);

  const lineGeometry = useMemo(() => {
    if (linePoints.length < 2) return null;
    const curve = new THREE.CatmullRomCurve3(linePoints);
    return new THREE.TubeGeometry(curve, linePoints.length * 2, 0.08, 4, false);
  }, [linePoints]);

  const lineMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    color: 0xd0c4a8,
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
  }), []);

  return (
    <group>
      {path.map((h, i) => {
        const [x, z] = axialToWorld(h.q, h.r, HEX_RADIUS);
        const tile = tiles.get(tileKey(h.q, h.r));
        const height = tile?.height ?? 0.3;
        return (
          <mesh key={`${h.q},${h.r}`} position={[x, height + 0.06, z]} rotation={[-Math.PI / 2, 0, Math.PI / 6]} geometry={geometry} material={material} />
        );
      })}
      {lineGeometry && <mesh geometry={lineGeometry} material={lineMaterial} />}
    </group>
  );
}

// ─── Supply Connection Overlay (cluster health: green = food surplus, red = deficit) ─

const SUPPLY_LINE_GREEN = 0x22c55e;
const SUPPLY_LINE_RED = 0xef4444;

function SupplyConnectionOverlay({ clustersWithHealth, tiles }: {
  clustersWithHealth: { paths: { q: number; r: number }[][]; foodSurplus: boolean }[];
  tiles: Map<string, Tile>;
}) {
  const materials = useMemo(() => ({
    green: new THREE.MeshBasicMaterial({
      color: SUPPLY_LINE_GREEN,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    }),
    red: new THREE.MeshBasicMaterial({
      color: SUPPLY_LINE_RED,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    }),
  }), []);

  const items = useMemo(() => {
    const result: { geo: THREE.TubeGeometry; foodSurplus: boolean }[] = [];
    for (const { paths, foodSurplus } of clustersWithHealth) {
      for (const path of paths) {
        if (path.length < 2) continue;
        const linePoints = path.map(h => {
          const [x, z] = axialToWorld(h.q, h.r, HEX_RADIUS);
          const tile = tiles.get(tileKey(h.q, h.r));
          const hgt = tile?.height ?? 0.3;
          return new THREE.Vector3(x, hgt + 0.12, z);
        });
        const curve = new THREE.CatmullRomCurve3(linePoints);
        result.push({ geo: new THREE.TubeGeometry(curve, linePoints.length * 2, 0.1, 4, false), foodSurplus });
      }
    }
    return result;
  }, [clustersWithHealth, tiles]);

  if (items.length === 0) return null;

  return (
    <group>
      {items.map(({ geo, foodSurplus }, i) => (
        <mesh key={i} geometry={geo} material={foodSurplus ? materials.green : materials.red} />
      ))}
    </group>
  );
}

// ─── Selection Ring ────────────────────────────────────────────────

function SelectionRing({ q, r, tiles }: { q: number; r: number; tiles: Map<string, Tile> }) {
  const tile = tiles.get(tileKey(q, r));
  if (!tile) return null;
  const [x, z] = axialToWorld(q, r, HEX_RADIUS);

  return (
    <mesh position={[x, tile.height + 0.03, z]} rotation={[-Math.PI / 2, 0, Math.PI / 6]}>
      <ringGeometry args={[HEX_RADIUS * 0.75, HEX_RADIUS * 0.98, 6]} />
      <meshBasicMaterial color="#ffff80" transparent opacity={0.7} depthWrite={false} side={THREE.DoubleSide} />
    </mesh>
  );
}

// ─── Pending City Preview Ring ──────────────────────────────────────

function PendingCityRing({ q, r, tiles }: { q: number; r: number; tiles: Map<string, Tile> }) {
  const tile = tiles.get(tileKey(q, r));
  if (!tile) return null;
  const [x, z] = axialToWorld(q, r, HEX_RADIUS);

  return (
    <mesh position={[x, tile.height + 0.04, z]} rotation={[-Math.PI / 2, 0, Math.PI / 6]}>
      <ringGeometry args={[HEX_RADIUS * 0.6, HEX_RADIUS * 1.0, 6]} />
      <meshBasicMaterial color="#44ff66" transparent opacity={0.8} depthWrite={false} side={THREE.DoubleSide} />
    </mesh>
  );
}

// ─── Battle Icons (animated crossed-swords on contested hexes) ────

function BattleIcons({ units, tiles }: { units: Unit[]; tiles: Map<string, Tile> }) {
  const groupRef = useRef<THREE.Group>(null);

  const battleHexes = useMemo(() => {
    const byHex: Record<string, Set<string>> = {};
    for (const u of units) {
      if (u.hp <= 0) continue;
      const key = tileKey(u.q, u.r);
      if (!byHex[key]) byHex[key] = new Set();
      byHex[key].add(u.ownerId);
    }
    const result: { q: number; r: number }[] = [];
    for (const [key, owners] of Object.entries(byHex)) {
      if (owners.size >= 2) {
        const [q, r] = key.split(',').map(Number);
        result.push({ q, r });
      }
    }
    return result;
  }, [units]);

  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    const t = clock.getElapsedTime();
    const bounce = Math.sin(t * 3) * 0.08;
    const pulse = 0.8 + Math.sin(t * 4) * 0.2;
    groupRef.current.children.forEach((child) => {
      child.position.y = (child.userData.baseY ?? 1.0) + bounce;
      child.scale.setScalar(pulse);
    });
  });

  if (battleHexes.length === 0) return null;

  return (
    <group ref={groupRef}>
      {battleHexes.map(({ q, r }) => {
        const tile = tiles.get(tileKey(q, r));
        const h = tile?.height ?? 0.3;
        const [x, z] = axialToWorld(q, r, HEX_RADIUS);
        const baseY = h + 1.0;
        return (
          <group key={`battle-${q},${r}`} position={[x, baseY, z]} userData={{ baseY }}>
            {/* Sword 1 (leaning right) */}
            <mesh rotation={[0, 0, Math.PI / 6]} position={[-0.08, 0, 0]}>
              <boxGeometry args={[0.04, 0.4, 0.04]} />
              <meshBasicMaterial color="#ff4444" />
            </mesh>
            {/* Sword 2 (leaning left) */}
            <mesh rotation={[0, 0, -Math.PI / 6]} position={[0.08, 0, 0]}>
              <boxGeometry args={[0.04, 0.4, 0.04]} />
              <meshBasicMaterial color="#ff4444" />
            </mesh>
            {/* Flash/glow sphere */}
            <mesh>
              <sphereGeometry args={[0.15, 8, 8]} />
              <meshBasicMaterial color="#ff2200" transparent opacity={0.35} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

// ─── Weather Effect Overlay (3D tint over terrain) ────────────────

function WeatherEffectOverlay({ weatherType, tiles }: {
  weatherType: WeatherEventType;
  tiles: Map<string, Tile>;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const allTiles = useMemo(() => {
    const result: Tile[] = [];
    tiles.forEach(tile => {
      if (tile.biome !== 'water') result.push(tile);
    });
    return result;
  }, [tiles]);

  const isTyphoon = weatherType === 'typhoon';
  const geometry = useMemo(() => makeHexGeo(HEX_RADIUS * HEX_INNER_RATIO * 0.96, 0.02), []);
  const material = useMemo(() => new THREE.MeshBasicMaterial({
    color: isTyphoon ? '#2288cc' : '#cc8833',
    transparent: true,
    opacity: isTyphoon ? 0.15 : 0.12,
    depthWrite: false,
  }), [isTyphoon]);

  // Animate opacity pulsing
  useFrame(({ clock }) => {
    if (!material) return;
    const t = clock.getElapsedTime();
    const pulse = isTyphoon
      ? 0.12 + Math.sin(t * 2) * 0.06
      : 0.10 + Math.sin(t * 1.5) * 0.04;
    material.opacity = pulse;
  });

  useEffect(() => {
    if (!meshRef.current || allTiles.length === 0) return;
    const mesh = meshRef.current;
    const dummy = new THREE.Object3D();
    allTiles.forEach((tile, i) => {
      const [x, z] = axialToWorld(tile.q, tile.r, HEX_RADIUS);
      dummy.position.set(x, tile.height + 0.06, z);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [allTiles]);

  if (allTiles.length === 0) return null;
  return <instancedMesh ref={meshRef} args={[geometry, material, allTiles.length]} renderOrder={10} />;
}

// ─── Typhoon 3D Rain Streaks ────────────────────────────────────────

function TyphoonRainEffect({ tiles }: { tiles: Map<string, Tile> }) {
  const groupRef = useRef<THREE.Group>(null);

  const rainDrops = useMemo(() => {
    const drops: { x: number; z: number; speed: number; offset: number }[] = [];
    const allTilesArr: Tile[] = [];
    tiles.forEach(t => { if (t.biome !== 'water') allTilesArr.push(t); });
    const allTiles = allTilesArr;
    const sampleSize = Math.min(80, allTiles.length);
    const step = Math.max(1, Math.floor(allTiles.length / sampleSize));
    for (let i = 0; i < allTiles.length; i += step) {
      const tile = allTiles[i];
      const [x, z] = axialToWorld(tile.q, tile.r, HEX_RADIUS);
      drops.push({
        x: x + (Math.random() - 0.5) * 0.8,
        z: z + (Math.random() - 0.5) * 0.8,
        speed: 2 + Math.random() * 3,
        offset: Math.random() * 10,
      });
    }
    return drops;
  }, [tiles]);

  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    const t = clock.getElapsedTime();
    groupRef.current.children.forEach((child, i) => {
      const drop = rainDrops[i];
      if (!drop) return;
      const y = 4 - ((t * drop.speed + drop.offset) % 5);
      child.position.y = y;
    });
  });

  return (
    <group ref={groupRef}>
      {rainDrops.map((drop, i) => (
        <mesh key={i} position={[drop.x, 4, drop.z]} rotation={[0, 0, 0.2]}>
          <boxGeometry args={[0.015, 0.25, 0.015]} />
          <meshBasicMaterial color="#66ccff" transparent opacity={0.4} />
        </mesh>
      ))}
    </group>
  );
}

// ─── Drought Heat Haze Effect ───────────────────────────────────────

function DroughtHazeEffect({ tiles }: { tiles: Map<string, Tile> }) {
  const groupRef = useRef<THREE.Group>(null);

  const hazeSpots = useMemo(() => {
    const spots: { x: number; z: number; h: number; scale: number; offset: number }[] = [];
    const allTilesArr: Tile[] = [];
    tiles.forEach(t => { if (t.biome !== 'water' && t.biome !== 'mountain') allTilesArr.push(t); });
    const allTiles = allTilesArr;
    const sampleSize = Math.min(40, allTiles.length);
    const step = Math.max(1, Math.floor(allTiles.length / sampleSize));
    for (let i = 0; i < allTiles.length; i += step) {
      const tile = allTiles[i];
      const [x, z] = axialToWorld(tile.q, tile.r, HEX_RADIUS);
      spots.push({
        x, z,
        h: tile.height + 0.5,
        scale: 0.3 + Math.random() * 0.4,
        offset: Math.random() * Math.PI * 2,
      });
    }
    return spots;
  }, [tiles]);

  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    const t = clock.getElapsedTime();
    groupRef.current.children.forEach((child, i) => {
      const spot = hazeSpots[i];
      if (!spot) return;
      const wobble = Math.sin(t * 1.5 + spot.offset) * 0.1;
      child.position.y = spot.h + wobble;
      const s = spot.scale * (0.9 + Math.sin(t * 2 + spot.offset) * 0.15);
      child.scale.set(s, 0.05, s);
    });
  });

  return (
    <group ref={groupRef}>
      {hazeSpots.map((spot, i) => (
        <mesh key={i} position={[spot.x, spot.h, spot.z]}>
          <sphereGeometry args={[1, 6, 4]} />
          <meshBasicMaterial color="#ffaa44" transparent opacity={0.08} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

// ─── Main HexGrid Component ───────────────────────────────────────

export default function HexGrid() {
  const tiles = useGameStore(s => s.tiles);
  const cities = useGameStore(s => s.cities);
  const units = useGameStore(s => s.units);
  const heroes = useGameStore(s => s.heroes);
  const territory = useGameStore(s => s.territory);
  const selectedHex = useGameStore(s => s.selectedHex);
  const players = useGameStore(s => s.players);
  const phase = useGameStore(s => s.phase);
  const uiMode = useGameStore(s => s.uiMode);
  const pendingMove = useGameStore(s => s.pendingMove);
  const visibleHexes = useGameStore(s => s.visibleHexes);
  const constructions = useGameStore(s => s.constructions);
  const roadConstructions = useGameStore(s => s.roadConstructions);
  const pendingCityHex = useGameStore(s => s.pendingCityHex);
  const activeWeather = useGameStore(s => s.activeWeather);
  const roadPathSelection = useGameStore(s => s.roadPathSelection);
  const supplyViewTab = useGameStore(s => s.supplyViewTab);
  const getSupplyClustersWithHealth = useGameStore(s => s.getSupplyClustersWithHealth);

  const visionActive = phase === 'playing';

  const supplyClustersWithHealth = useMemo(() => {
    if (supplyViewTab !== 'supply') return [];
    return getSupplyClustersWithHealth();
  }, [supplyViewTab, getSupplyClustersWithHealth, cities, units]);

  const biomeGroups = useMemo(() => {
    const groups: Record<Biome, Tile[]> = {
      water: [], plains: [], forest: [], mountain: [], desert: [],
    };
    const roadTiles: Tile[] = [];
    const ruinTiles: Tile[] = [];
    const villageTiles: Tile[] = [];

    Array.from(tiles.values()).forEach(tile => {
      groups[tile.biome].push(tile);
      if (tile.hasRoad) roadTiles.push(tile);
      if (tile.hasRuins) ruinTiles.push(tile);
      if (tile.hasVillage) villageTiles.push(tile);
    });
    return { groups, roadTiles, ruinTiles, villageTiles };
  }, [tiles]);

  // Territory by player
  const territoryByPlayer = useMemo(() => {
    const byPlayer: Record<string, string[]> = {};
    Array.from(territory.entries()).forEach(([key, info]) => {
      if (!byPlayer[info.playerId]) byPlayer[info.playerId] = [];
      byPlayer[info.playerId].push(key);
    });
    return byPlayer;
  }, [territory]);

  // Two-tier vision: everything is always visible (terrain, cities, buildings, territory).
  // Only ENEMY UNITS and HEROES are hidden unless within active vision range.
  const visibleUnits = useMemo(() => {
    if (!visionActive) return units;
    return units.filter(u => {
      if (u.ownerId.includes('human')) return true;
      return visibleHexes.has(tileKey(u.q, u.r));
    });
  }, [units, visionActive, visibleHexes]);

  const visibleHeroes = useMemo(() => {
    if (!visionActive) return heroes;
    return heroes.filter(h => {
      if (h.ownerId.includes('human')) return true;
      return visibleHexes.has(tileKey(h.q, h.r));
    });
  }, [heroes, visionActive, visibleHexes]);

  return (
    <group>
      {/* Terrain */}
      {(Object.entries(biomeGroups.groups) as [Biome, Tile[]][]).map(([biome, bTiles]) => (
        <TerrainLayer key={biome} tiles={bTiles} biome={biome} />
      ))}
      <MountainSnowLayer tiles={biomeGroups.groups.mountain} />

      {/* Map features */}
      <RoadOverlay tiles={biomeGroups.roadTiles} />
      <RoadConstructionOverlay sites={roadConstructions} tiles={tiles} />
      <OverlayLayer tiles={biomeGroups.ruinTiles} color={RUINS_COLOR} yOffset={0.1} radiusScale={0.28} height={0.18} />
      <VillageLayer tiles={biomeGroups.villageTiles} />

      {/* Resource deposit indicators */}
      <DepositMarkers tiles={tiles} />

      {/* Territory overlays (always visible) */}
      {players.map(p => (
        territoryByPlayer[p.id] && (
          <TerritoryOverlay
            key={p.id}
            playerColor={p.color}
            tileKeys={territoryByPlayer[p.id]}
            tiles={tiles}
          />
        )
      ))}

      {/* Game entities — cities/buildings always visible, units/heroes vision-filtered */}
      <CityMarkers cities={cities} tiles={tiles} />
      <BuildingMarkers cities={cities} tiles={tiles} />
      <ConstructionMarkers sites={constructions} tiles={tiles} />
      <UnitMarkers units={visibleUnits} tiles={tiles} />
      <UnitHpBars units={visibleUnits} tiles={tiles} />
      <HeroMarkers heroes={visibleHeroes} tiles={tiles} />
      <BattleIcons units={visibleUnits} tiles={tiles} />

      {/* Weather visual effects */}
      {activeWeather && (
        <>
          <WeatherEffectOverlay weatherType={activeWeather.type} tiles={tiles} />
          {activeWeather.type === 'typhoon' && <TyphoonRainEffect tiles={tiles} />}
          {activeWeather.type === 'drought' && <DroughtHazeEffect tiles={tiles} />}
        </>
      )}

      {/* Move range highlight when unit is selected */}
      {uiMode === 'move' && selectedHex && (
        <MoveRangeOverlay fromQ={selectedHex.q} fromR={selectedHex.r} tiles={tiles} />
      )}

      {/* Pending move destination marker */}
      {pendingMove && <PendingCityRing q={pendingMove.toQ} r={pendingMove.toR} tiles={tiles} />}

      {/* Pending city preview during placement */}
      {pendingCityHex && <PendingCityRing q={pendingCityHex.q} r={pendingCityHex.r} tiles={tiles} />}

      {/* Mine deposit highlights (builder build mode) */}
      {uiMode === 'build_mine' && (
        <DepositHighlightOverlay tiles={tiles} cities={cities} constructions={constructions} depositType="mine" />
      )}
      {/* Quarry deposit highlights (builder build mode) */}
      {uiMode === 'build_quarry' && (
        <DepositHighlightOverlay tiles={tiles} cities={cities} constructions={constructions} depositType="quarry" />
      )}
      {uiMode === 'build_gold_mine' && (
        <DepositHighlightOverlay tiles={tiles} cities={cities} constructions={constructions} depositType="gold_mine" />
      )}
      {/* Road path preview (builder build mode) */}
      {uiMode === 'build_road' && roadPathSelection.length > 0 && (
        <RoadPathOverlay path={roadPathSelection} tiles={tiles} />
      )}

      {/* Supply view: logistics connection lines (green = food surplus, red = deficit) */}
      {supplyViewTab === 'supply' && supplyClustersWithHealth.length > 0 && (
        <SupplyConnectionOverlay clustersWithHealth={supplyClustersWithHealth} tiles={tiles} />
      )}

      {/* Selection */}
      {selectedHex && <SelectionRing q={selectedHex.q} r={selectedHex.r} tiles={tiles} />}
    </group>
  );
}
