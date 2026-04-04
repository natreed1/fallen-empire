'use client';

import { useMemo, useRef, useEffect, useLayoutEffect, useState } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { useGameStore } from '@/store/useGameStore';
import {
  Biome, Tile, City, Unit, Hero, Commander, ConstructionSite, WallSection, RoadConstructionSite, ScoutTower,
  DefenseInstallation, DefenseTowerType,
  DEFENSE_TOWER_MORTAR_RANGE, DEFENSE_TOWER_ARCHER_RANGE,
  BuildingType,
  WeatherEventType,
  BIOME_COLORS, BIOME_COLORS_DARK, ROAD_COLOR,
  MOUNTAIN_SNOW_COLOR, PLAYER_COLORS,
  HEX_RADIUS, HEX_INNER_RATIO, axialToWorld, tileKey, parseTileKey, hexDistance, hexNeighbors,
  CONTESTED_ZONE_COLOR, GOLD_MINE_DEPOSIT_COLOR, QUARRY_DEPOSIT_COLOR, WOOD_DEPOSIT_COLOR,
  isNavalUnitType, MOVE_ORDER_MAX_IN_TERRITORY_BAND,
  SPECIAL_REGION_OVERLAY_COLORS,
  type SpecialRegionKind,
} from '@/types/game';
import { isGarrisonedAtCity } from '@/lib/garrison';
import { createTerrainHexTopGeometry, defaultBiomePaintRadius } from '@/lib/hexTopGeometry';
import type { DefenseVolleyFx, RangedShotFx } from '@/lib/military';

const PLAYER_HUMAN_ID = 'player_human';

const HEX_SEGMENTS = 6;
const UNIT_HEIGHT = 1.0;

/** Billboards & map meshes above special-region tints/decals (see BiomeTextureLayer renderOrder 2–6). */
const MAP_ENTITY_RENDER_ORDER = 12;
const SPECIAL_REGION_TINT_RENDER_ORDER = 1;

// ─── Sprite Texture Loader ──────────────────────────────────────────
// Loads all game sprite textures once with nearest-neighbor filtering for pixel art crispness.
//
// PNG requirements for correct display:
// - RGBA with transparency (straight/non-premultiplied alpha)
// - Power-of-two dimensions recommended (e.g. 64×64)
// - Crisp pixel edges; no anti-aliasing on pixel boundaries
// Texture loader uses premultiplyAlpha: false — PNGs must NOT be premultiplied.
// Re-run `python3 scripts/cleanup_sprite_backgrounds.py` after exporting new sprites if
// flat grey / white borders remain (edge flood to alpha).

const SPRITE_PATHS: Record<string, string> = {
  // Units
  infantry: '/sprites/units/infantry.png',
  cavalry:  '/sprites/units/cavalry.png',
  archer:   '/sprites/units/archer.png',
  builder:  '/sprites/units/builder.png',
  trebuchet: '/sprites/units/trebuchet.png',
  defender:  '/sprites/units/infantry.png', // placeholder until defender.png exists
  scout_ship: '/sprites/units/scout_ship.png',
  warship: '/sprites/units/warship.png',
  transport_ship: '/sprites/units/transport_ship.png',
  fisher_transport: '/sprites/units/fisher_transport.png',
  capital_ship: '/sprites/units/capital_ship.png',
  horse_archer: '/sprites/units/horse_archer.png',
  crusader_knight: '/sprites/units/crusader_knight.png',
  // Buildings
  farm:        '/sprites/buildings/farm.png',
  banana_farm: '/sprites/buildings/banana_farm.png',
  factory:     '/sprites/buildings/factory.png',
  city_center: '/sprites/buildings/silo.png',
  barracks:    '/sprites/buildings/barracks.png',
  academy:     '/sprites/buildings/academy.png',
  market:      '/sprites/buildings/market.png',
  quarry:   '/sprites/buildings/quarry.png',
  mine:     '/sprites/buildings/mine.png',
  gold_mine: '/sprites/buildings/gold_mine.png',
  sawmill: '/sprites/buildings/sawmill.png',
  port: '/sprites/buildings/port.png',
  shipyard: '/sprites/buildings/shipyard.png',
  fishery: '/sprites/buildings/fishery.png',
  logging_hut: '/sprites/buildings/logging_hut.png',
  wall:     '/sprites/buildings/wall.png',
  defense_mortar: '/sprites/buildings/mortar_battery.png',
  defense_archer_tower: '/sprites/buildings/archer_tower_defense.png',
  defense_ballista: '/sprites/buildings/ballista_tower.png',
  // Entities
  city:     '/sprites/entities/city.png',
  village:  '/sprites/entities/village.png',
  tree:     '/sprites/entities/tree.png',
  mountain:        '/sprites/entities/mountain.png',
  ruins:           '/sprites/entities/ruins.png',
  deposit_quarry:  '/sprites/entities/deposit_quarry.png',
  deposit_mine:    '/sprites/entities/deposit_mine.png',
  deposit_gold:    '/sprites/entities/deposit_gold.png',
  deposit_wood:    '/sprites/entities/deposit_wood.png',
  deposit_ancient: '/sprites/entities/deposit_ancient.png',
  hero:     '/sprites/entities/hero.png',
  // Overlays (pixel art, tileable)
  road:     '/sprites/overlays/road.png',
  // Biome painted hex tops (variants + coast/beach — npm run generate-biomes)
  ...(() => {
    const m: Record<string, string> = {};
    (['water', 'plains', 'forest', 'mountain', 'desert'] as const).forEach(b => {
      for (let v = 0; v < 4; v++) {
        m[`biome_${b}_${v}`] = `/sprites/overlays/biomes/${b}_${v}.png`;
      }
    });
    return m;
  })(),
  biome_water_coast: '/sprites/overlays/biomes/water_coast.png',
  biome_beach: '/sprites/overlays/biomes/beach.png',
  feature_quarry:  '/sprites/overlays/biomes/feature_quarry.png',
  feature_mine:    '/sprites/overlays/biomes/feature_mine.png',
  feature_gold:    '/sprites/overlays/biomes/feature_gold.png',
  feature_wood:    '/sprites/overlays/biomes/feature_wood.png',
  feature_ancient: '/sprites/overlays/biomes/feature_ancient.png',
  // Ruins: isometric hex-cap art (variants — npm run generate-biomes does not create these)
  ...(() => {
    const m: Record<string, string> = {};
    for (let v = 0; v < 4; v++) {
      m[`overlay_ruins_${v}`] = `/sprites/overlays/biomes/overlay_ruins_${v}.png`;
    }
    return m;
  })(),
  // Special scroll regions (npm run generate-special-regions / scripts/generate_special_region_overlays.py)
  ...(() => {
    const m: Record<string, string> = {};
    (
      [
        'sr_forest_secrets',
        'sr_mexca',
        'sr_hills_lost',
        'sr_isle_lost_land',
        'sr_isle_lost_water',
        'sr_isle_lost_wreck',
      ] as const
    ).forEach(prefix => {
      for (let v = 0; v < 4; v++) {
        m[`${prefix}_${v}`] = `/sprites/overlays/biomes/${prefix}_${v}.png`;
      }
    });
    return m;
  })(),
};

const textureCache = new Map<string, THREE.Texture>();
const textureLoader = new THREE.TextureLoader();
const SPRITE_CACHE_BUST = `?v=${Date.now()}`;

function getSpriteTexture(key: string): THREE.Texture {
  if (textureCache.has(key)) return textureCache.get(key)!;
  const path = SPRITE_PATHS[key];
  if (!path) {
    const fallback = new THREE.Texture();
    textureCache.set(key, fallback);
    return fallback;
  }
  const tex = textureLoader.load(path + SPRITE_CACHE_BUST);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.anisotropy = 1;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.premultiplyAlpha = false;
  // Planar UVs on hex caps use v = 1 - ẑ; do not flip like default DOM images.
  if (path.includes('/overlays/biomes/')) {
    tex.flipY = false;
  }
  textureCache.set(key, tex);
  return tex;
}

/** World-space billboards on orthographic camera: no distance shrink; crisp alpha. */
const MAP_ENTITY_SPRITE_MAT = {
  transparent: true as const,
  alphaTest: 0.08,
  depthWrite: false,
  sizeAttenuation: false,
};

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

/** Stable 0–1 hash per hex for parchment-like color grain (no allocation). */
function terrainHash01(q: number, r: number): number {
  const n = ((q * 92837111) ^ (r * 689287499)) >>> 0;
  return (n % 10007) / 10007;
}

/** Stable variant 0–3 for texture atlas / instancing buckets. */
function variantBucketIndex(q: number, r: number): number {
  return Math.min(3, Math.floor(terrainHash01(q, r) * 4));
}

function bucketTilesByVariant(tileList: Tile[]): [Tile[], Tile[], Tile[], Tile[]] {
  const b: Tile[][] = [[], [], [], []];
  for (const t of tileList) {
    b[variantBucketIndex(t.q, t.r)].push(t);
  }
  return [b[0], b[1], b[2], b[3]];
}

function isCoastalWaterTile(tile: Tile, tiles: Map<string, Tile>): boolean {
  if (tile.biome !== 'water') return false;
  return hexNeighbors(tile.q, tile.r).some(([nq, nr]) => {
    const n = tiles.get(tileKey(nq, nr));
    return n != null && n.biome !== 'water';
  });
}

function isBeachLandTile(tile: Tile, tiles: Map<string, Tile>): boolean {
  if (tile.biome === 'water') return false;
  return hexNeighbors(tile.q, tile.r).some(([nq, nr]) => tiles.get(tileKey(nq, nr))?.biome === 'water');
}

// ─── Terrain Layer ─────────────────────────────────────────────────

function TerrainLayer({ tiles, biome }: { tiles: Tile[]; biome: Biome }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const count = tiles.length;
  const geometry = useMemo(() => makeHexGeo(HEX_RADIUS * HEX_INNER_RATIO, UNIT_HEIGHT), []);

  // MeshStandardMaterial: soft modern shading; high roughness keeps a painted / pixel-adjacent look.
  const material = useMemo(() => {
    const baseColor = new THREE.Color(BIOME_COLORS[biome]);
    return new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: biome === 'water' ? 0.55 : 0.88,
      metalness: biome === 'water' ? 0.06 : 0,
      emissive: baseColor,
      emissiveIntensity: biome === 'water' ? 0.08 : 0.1,
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

      const t = (tile.elevation + 1) / 2;
      const c = base.clone().lerp(dark, (1.0 - t) * 0.34);
      const grain = terrainHash01(tile.q, tile.r);
      c.multiplyScalar(0.93 + grain * 0.14);
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
    mesh.instanceColor.needsUpdate = true;
  }, [tiles, biome, count, geometry]);

  if (count === 0) return null;
  return <instancedMesh ref={meshRef} args={[geometry, material, count]} raycast={() => null} />;
}

/** Hairline separators — keeps grid readable without carving the map into heavy tiles. */
const MAP_HEX_OUTLINE_COLOR = '#3a332b';

function MedievalHexOutlineLayer({ tiles }: { tiles: Tile[] }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const count = tiles.length;
  const r = HEX_RADIUS * HEX_INNER_RATIO;
  const geometry = useMemo(
    () =>
      // Very thin band: ~1.5% of radius — reads as stitch, not a wall
      new THREE.RingGeometry(r * 0.982, r * 0.996, 6),
    [r],
  );
  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: MAP_HEX_OUTLINE_COLOR,
        transparent: true,
        opacity: 0.1,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    [],
  );

  useEffect(() => {
    if (!meshRef.current || count === 0) return;
    const mesh = meshRef.current;
    const dummy = new THREE.Object3D();
    tiles.forEach((tile, i) => {
      const [x, z] = axialToWorld(tile.q, tile.r, HEX_RADIUS);
      dummy.position.set(x, tile.height + 0.038, z);
      dummy.rotation.set(-Math.PI / 2, 0, Math.PI / 6);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [tiles, count]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  if (count === 0) return null;
  return <instancedMesh ref={meshRef} args={[geometry, material, count]} raycast={() => null} renderOrder={5} />;
}

/** Pixel-art biome hex tops: variant texture key + slight scale jitter. Instance Y rotation is identity —
 * the hex-cap geometry is already aligned with the terrain prism; rotating 60° per tile misaligned art
 * (especially forest / isometric paints) vs the grid. */
function BiomeTextureLayer({
  tiles,
  textureKey,
  opacity = 1,
  renderOrder = 2,
  surfaceYOffset = 0.021,
  /** RGBA decals (e.g. resource patches) need blending + a bit more polygon offset. */
  transparentMap = false,
  /** Optional discard threshold for masked hex caps (sr_*); keep 0 for soft feature art. */
  alphaTest = 0,
}: {
  tiles: Tile[];
  textureKey: string;
  opacity?: number;
  renderOrder?: number;
  surfaceYOffset?: number;
  transparentMap?: boolean;
  alphaTest?: number;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const count = tiles.length;
  const geometry = useMemo(() => createTerrainHexTopGeometry(defaultBiomePaintRadius()), []);
  const tex = useMemo(() => getSpriteTexture(textureKey), [textureKey]);
  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: tex,
        transparent: transparentMap || opacity < 1,
        opacity,
        depthWrite: false,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: transparentMap ? -1 : -0.5,
        polygonOffsetUnits: transparentMap ? 3 : 2,
        alphaTest,
      }),
    [tex, opacity, transparentMap, alphaTest],
  );

  useEffect(() => {
    if (!meshRef.current || count === 0) return;
    const mesh = meshRef.current;
    const dummy = new THREE.Object3D();
    tiles.forEach((tile, i) => {
      const [x, z] = axialToWorld(tile.q, tile.r, HEX_RADIUS);
      // Never scale below 1 — sub-1.0 shrinks the cap inside the prism and shows dark sides as “black cracks”.
      const sc = 1.005 + terrainHash01(tile.q + 2, tile.r + 5) * 0.02;
      dummy.position.set(x, tile.height + surfaceYOffset, z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(sc, sc, sc);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [tiles, count, surfaceYOffset]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  if (count === 0) return null;
  return <instancedMesh ref={meshRef} args={[geometry, material, count]} raycast={() => null} renderOrder={renderOrder} />;
}

/** Resource deposit billboard sprites — one per deposit tile, floating above terrain. */
function DepositSpriteLayer({ tiles }: { tiles: Map<string, Tile> }) {
  const texQuarry = useMemo(() => getSpriteTexture('deposit_quarry'), []);
  const texMine = useMemo(() => getSpriteTexture('deposit_mine'), []);
  const texGold = useMemo(() => getSpriteTexture('deposit_gold'), []);
  const texWood = useMemo(() => getSpriteTexture('deposit_wood'), []);
  const texAncient = useMemo(() => getSpriteTexture('deposit_ancient'), []);

  const deposits = useMemo(() => {
    const out: { tile: Tile; tex: THREE.Texture }[] = [];
    for (const t of tiles.values()) {
      if (t.hasQuarryDeposit) out.push({ tile: t, tex: texQuarry });
      if (t.hasMineDeposit) out.push({ tile: t, tex: texMine });
      if (t.hasGoldMineDeposit) out.push({ tile: t, tex: texGold });
      if (t.hasWoodDeposit) out.push({ tile: t, tex: texWood });
      if (t.hasAncientCity) out.push({ tile: t, tex: texAncient });
    }
    return out;
  }, [tiles, texQuarry, texMine, texGold, texWood, texAncient]);

  if (deposits.length === 0) return null;
  return (
    <group>
      {deposits.map((d, i) => {
        const [x, z] = axialToWorld(d.tile.q, d.tile.r, HEX_RADIUS);
        return (
          <sprite key={`dep_${tileKey(d.tile.q, d.tile.r)}_${i}`} position={[x, d.tile.height + 0.4, z]} scale={[1.0, 1.0, 1]} raycast={() => null} renderOrder={MAP_ENTITY_RENDER_ORDER}>
            <spriteMaterial map={d.tex} {...MAP_ENTITY_SPRITE_MAT} />
          </sprite>
        );
      })}
    </group>
  );
}

/** Ruins — billboard sprites placed on ruin tiles, like villages/trees. */
function RuinSpriteLayer({ tiles }: { tiles: Tile[] }) {
  const tex = useMemo(() => getSpriteTexture('ruins'), []);

  if (tiles.length === 0) return null;
  return (
    <group>
      {tiles.map(tile => {
        const [x, z] = axialToWorld(tile.q, tile.r, HEX_RADIUS);
        return (
          <sprite key={`ruin_${tileKey(tile.q, tile.r)}`} position={[x, tile.height + 0.5, z]} scale={[1.2, 1.2, 1]} raycast={() => null} renderOrder={MAP_ENTITY_RENDER_ORDER}>
            <spriteMaterial map={tex} {...MAP_ENTITY_SPRITE_MAT} />
          </sprite>
        );
      })}
    </group>
  );
}

/** Scroll terrain — hex-cap decals from Tile.specialTerrainKind (sprinkled across biomes). */
function SpecialRegionTextureDecals({ tiles }: { tiles: Map<string, Tile> }) {
  const {
    forestBuckets,
    mexcaBuckets,
    hillsBuckets,
    isleLandBuckets,
    isleWaterBuckets,
    isleCoastWreckBuckets,
  } = useMemo(() => {
    const forest: Tile[] = [];
    const mexca: Tile[] = [];
    const hills: Tile[] = [];
    const isleLand: Tile[] = [];
    const isleWater: Tile[] = [];
    const isleCoast: Tile[] = [];

    for (const t of tiles.values()) {
      const k = t.specialTerrainKind;
      if (!k) continue;
      switch (k) {
        case 'forest_secrets':
          forest.push(t);
          break;
        case 'mexca':
          mexca.push(t);
          break;
        case 'hills_lost':
          hills.push(t);
          break;
        case 'isle_lost':
          if (t.biome === 'water') {
            isleWater.push(t);
          } else {
            isleLand.push(t);
            if (isBeachLandTile(t, tiles)) isleCoast.push(t);
          }
          break;
        default:
          break;
      }
    }

    return {
      forestBuckets: bucketTilesByVariant(forest),
      mexcaBuckets: bucketTilesByVariant(mexca),
      hillsBuckets: bucketTilesByVariant(hills),
      isleLandBuckets: bucketTilesByVariant(isleLand),
      isleWaterBuckets: bucketTilesByVariant(isleWater),
      isleCoastWreckBuckets: bucketTilesByVariant(isleCoast),
    };
  }, [tiles]);

  const y = 0.028;
  const ro = 4;
  const roWreck = 6;

  return (
    <>
      {[0, 1, 2, 3].map(v => (
        <BiomeTextureLayer
          key={`sr-fs-${v}`}
          tiles={forestBuckets[v]}
          textureKey={`sr_forest_secrets_${v}`}
          renderOrder={ro}
          surfaceYOffset={y}
          opacity={0.94}
          transparentMap
          alphaTest={0.04}
        />
      ))}
      {[0, 1, 2, 3].map(v => (
        <BiomeTextureLayer
          key={`sr-mx-${v}`}
          tiles={mexcaBuckets[v]}
          textureKey={`sr_mexca_${v}`}
          renderOrder={ro}
          surfaceYOffset={y}
          opacity={0.94}
          transparentMap
          alphaTest={0.04}
        />
      ))}
      {[0, 1, 2, 3].map(v => (
        <BiomeTextureLayer
          key={`sr-hl-${v}`}
          tiles={hillsBuckets[v]}
          textureKey={`sr_hills_lost_${v}`}
          renderOrder={ro}
          surfaceYOffset={y}
          opacity={0.94}
          transparentMap
          alphaTest={0.04}
        />
      ))}
      {[0, 1, 2, 3].map(v => (
        <BiomeTextureLayer
          key={`sr-ill-${v}`}
          tiles={isleLandBuckets[v]}
          textureKey={`sr_isle_lost_land_${v}`}
          renderOrder={ro}
          surfaceYOffset={y}
          opacity={0.94}
          transparentMap
          alphaTest={0.04}
        />
      ))}
      {[0, 1, 2, 3].map(v => (
        <BiomeTextureLayer
          key={`sr-ilw-${v}`}
          tiles={isleWaterBuckets[v]}
          textureKey={`sr_isle_lost_water_${v}`}
          renderOrder={ro}
          surfaceYOffset={y}
          opacity={0.94}
          transparentMap
          alphaTest={0.04}
        />
      ))}
      {[0, 1, 2, 3].map(v => (
        <BiomeTextureLayer
          key={`sr-ilwr-${v}`}
          tiles={isleCoastWreckBuckets[v]}
          textureKey={`sr_isle_lost_wreck_${v}`}
          renderOrder={roWreck}
          surfaceYOffset={y + 0.004}
          opacity={0.94}
          transparentMap
          alphaTest={0.04}
        />
      ))}
    </>
  );
}

function LandBiomeVariantLayers({ tiles, biome }: { tiles: Tile[]; biome: Exclude<Biome, 'water'> }) {
  const buckets = useMemo(() => bucketTilesByVariant(tiles), [tiles]);
  const useTransparency = biome === 'forest' || biome === 'mountain';
  return (
    <>
      {[0, 1, 2, 3].map(v => (
        <BiomeTextureLayer
          key={`${biome}-v${v}`}
          tiles={buckets[v]}
          textureKey={`biome_${biome}_${v}`}
          {...(useTransparency && { transparentMap: true, alphaTest: 0.03 })}
        />
      ))}
    </>
  );
}

function DeepWaterVariantLayers({ tiles }: { tiles: Tile[] }) {
  const buckets = useMemo(() => bucketTilesByVariant(tiles), [tiles]);
  return (
    <>
      {[0, 1, 2, 3].map(v => (
        <BiomeTextureLayer key={`water-v${v}`} tiles={buckets[v]} textureKey={`biome_water_${v}`} />
      ))}
    </>
  );
}

/** Sand strip on land hexes that touch the ocean — reads as shoreline. */
function BeachSandLayer({ tiles }: { tiles: Tile[] }) {
  return <BiomeTextureLayer tiles={tiles} textureKey="biome_beach" opacity={0.78} renderOrder={3} />;
}

// ─── Mountain Snow ─────────────────────────────────────────────────

function MountainSnowLayer({ tiles, tilesMap }: { tiles: Tile[]; tilesMap: Map<string, Tile> }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const snowTiles = useMemo(() => {
    if (tiles.length === 0) return [];
    const scored = tiles.map(t => {
      let s = t.height;
      if (
        hexNeighbors(t.q, t.r).some(([nq, nr]) => tilesMap.get(tileKey(nq, nr))?.biome === 'mountain')
      ) {
        s += 0.18;
      }
      s += terrainHash01(t.q, t.r) * 0.06;
      return { t, s };
    });
    scored.sort((a, b) => b.s - a.s);
    const n = Math.max(1, Math.floor(tiles.length * 0.52));
    return scored.slice(0, n).map(x => x.t);
  }, [tiles, tilesMap]);

  const geometry = useMemo(
    () => makeHexGeo(HEX_RADIUS * HEX_INNER_RATIO * 0.5, 0.12),
    [],
  );
  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: MOUNTAIN_SNOW_COLOR,
        roughness: 0.62,
        metalness: 0.02,
        emissive: MOUNTAIN_SNOW_COLOR,
        emissiveIntensity: 0.2,
      }),
    [],
  );

  useEffect(() => {
    if (!meshRef.current || snowTiles.length === 0) return;
    const mesh = meshRef.current;
    const dummy = new THREE.Object3D();
    snowTiles.forEach((tile, i) => {
      const [x, z] = axialToWorld(tile.q, tile.r, HEX_RADIUS);
      const sc = 0.97 + terrainHash01(tile.q + 19, tile.r + 3) * 0.06;
      dummy.position.set(x, tile.height + 0.095, z);
      dummy.scale.set(sc, 1, sc);
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

// Wall sections — tower sprites at each wall hex + 3D connecting segments between adjacent walls
function WallOverlay({ wallSections, tiles, players }: { wallSections: WallSection[]; tiles: Map<string, Tile>; players: { id: string; color: string }[] }) {
  const wallTex = useMemo(() => getSpriteTexture('wall'), []);
  const intact = useMemo(() => wallSections.filter(w => (w.hp ?? 1) > 0), [wallSections]);

  const { wallTiles, segments } = useMemo(() => {
    const wallKeys = new Set(intact.map(w => tileKey(w.q, w.r)));
    const ownerByKey = new Map(intact.map(w => [tileKey(w.q, w.r), w.ownerId]));
    const wTiles: { tile: Tile; color: string }[] = [];
    const segs: { x1: number; z1: number; x2: number; z2: number; y: number; color: string; key: string }[] = [];
    const seenEdges = new Set<string>();

    const playerColorMap = new Map(players.map(p => [p.id, p.color]));

    for (const w of intact) {
      const tile = tiles.get(tileKey(w.q, w.r));
      if (!tile) continue;
      const color = playerColorMap.get(w.ownerId) ?? '#888888';
      wTiles.push({ tile, color });

      for (const [nq, nr] of hexNeighbors(w.q, w.r)) {
        const nk = tileKey(nq, nr);
        if (!wallKeys.has(nk)) continue;
        if (ownerByKey.get(nk) !== w.ownerId) continue;
        const edgeKey = [tileKey(w.q, w.r), nk].sort().join('_');
        if (seenEdges.has(edgeKey)) continue;
        seenEdges.add(edgeKey);
        const nTile = tiles.get(nk);
        if (!nTile) continue;
        const [x1, z1] = axialToWorld(w.q, w.r, HEX_RADIUS);
        const [x2, z2] = axialToWorld(nq, nr, HEX_RADIUS);
        const avgY = (tile.height + nTile.height) / 2;
        segs.push({ x1, z1, x2, z2, y: avgY, color, key: edgeKey });
      }
    }
    return { wallTiles: wTiles, segments: segs };
  }, [intact, tiles, players]);

  const segMeshRef = useRef<THREE.InstancedMesh>(null);
  const segGeo = useMemo(() => new THREE.BoxGeometry(1, 0.18, 0.12), []);
  const segMat = useMemo(() => new THREE.MeshLambertMaterial({
    color: '#a89880',
    emissive: '#a89880',
    emissiveIntensity: 0.08,
  }), []);

  useEffect(() => {
    if (!segMeshRef.current || segments.length === 0) return;
    const mesh = segMeshRef.current;
    const dummy = new THREE.Object3D();
    segments.forEach((seg, i) => {
      const mx = (seg.x1 + seg.x2) / 2;
      const mz = (seg.z1 + seg.z2) / 2;
      const dx = seg.x2 - seg.x1;
      const dz = seg.z2 - seg.z1;
      const len = Math.sqrt(dx * dx + dz * dz);
      const angle = Math.atan2(dz, dx);
      dummy.position.set(mx, seg.y + 0.15, mz);
      dummy.rotation.set(0, -angle, 0);
      dummy.scale.set(len * 0.85, 1, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [segments]);

  return (
    <group>
      {segments.length > 0 && (
        <instancedMesh ref={segMeshRef} args={[segGeo, segMat, segments.length]} raycast={() => null} renderOrder={MAP_ENTITY_RENDER_ORDER - 1} />
      )}
      {wallTiles.map(({ tile }) => {
        const [x, z] = axialToWorld(tile.q, tile.r, HEX_RADIUS);
        return (
          <sprite key={`wall_${tileKey(tile.q, tile.r)}`} position={[x, tile.height + 0.5, z]} scale={[1.0, 1.0, 1]} raycast={() => null} renderOrder={MAP_ENTITY_RENDER_ORDER}>
            <spriteMaterial map={wallTex} {...MAP_ENTITY_SPRITE_MAT} />
          </sprite>
        );
      })}
    </group>
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
          <sprite key={tileKey(tile.q, tile.r)} position={[x, tile.height + 0.5, z]} scale={[1.2, 1.2, 1]} raycast={() => null} renderOrder={MAP_ENTITY_RENDER_ORDER}>
            <spriteMaterial map={tex} {...MAP_ENTITY_SPRITE_MAT} />
          </sprite>
        );
      })}
    </group>
  );
}

// ─── Forest Tree Sprites ────────────────────────────────────────────

function ForestTreeLayer({ tiles }: { tiles: Tile[] }) {
  const tex = useMemo(() => getSpriteTexture('tree'), []);

  if (tiles.length === 0) return null;
  const scatter = HEX_RADIUS * 0.6;
  return (
    <group>
      {tiles.flatMap(tile => {
        const [cx, cz] = axialToWorld(tile.q, tile.r, HEX_RADIUS);
        const baseHash = ((tile.q * 92837111) ^ (tile.r * 689287499)) >>> 0;
        const treeCount = 3 + (baseHash % 3);
        const key = tileKey(tile.q, tile.r);
        const sprites: JSX.Element[] = [];
        for (let i = 0; i < treeCount; i++) {
          const h1 = ((baseHash + i * 127_031) * 16807) >>> 0;
          const h2 = ((baseHash + i * 253_993) * 48271) >>> 0;
          const h3 = ((baseHash + i * 374_761) * 69621) >>> 0;
          const angle = ((h1 % 10000) / 10000) * Math.PI * 2;
          const dist = Math.sqrt((h2 % 10000) / 10000) * scatter;
          const dx = Math.cos(angle) * dist;
          const dz = Math.sin(angle) * dist;
          const scale = 0.9 + ((h3 % 1000) / 1000) * 0.4;
          const dy = ((h1 % 500) / 1000) * 0.15;
          sprites.push(
            <sprite
              key={`${key}_t${i}`}
              position={[cx + dx, tile.height + 0.5 + dy, cz + dz]}
              scale={[scale, scale, 1]}
              raycast={() => null}
              renderOrder={MAP_ENTITY_RENDER_ORDER}
            >
              <spriteMaterial map={tex} {...MAP_ENTITY_SPRITE_MAT} />
            </sprite>,
          );
        }
        return sprites;
      })}
    </group>
  );
}

// ─── Mountain Peak Sprites ──────────────────────────────────────────

function MountainPeakLayer({ tiles }: { tiles: Tile[] }) {
  const tex = useMemo(() => getSpriteTexture('mountain'), []);

  if (tiles.length === 0) return null;
  const scatter = HEX_RADIUS * 0.5;
  return (
    <group>
      {tiles.flatMap(tile => {
        const [cx, cz] = axialToWorld(tile.q, tile.r, HEX_RADIUS);
        const baseHash = ((tile.q * 72937111) ^ (tile.r * 589287499)) >>> 0;
        const peakCount = 2 + (baseHash % 2);
        const key = tileKey(tile.q, tile.r);
        const sprites: JSX.Element[] = [];
        for (let i = 0; i < peakCount; i++) {
          const h1 = ((baseHash + i * 137_031) * 16807) >>> 0;
          const h2 = ((baseHash + i * 263_993) * 48271) >>> 0;
          const h3 = ((baseHash + i * 384_761) * 69621) >>> 0;
          const angle = ((h1 % 10000) / 10000) * Math.PI * 2;
          const dist = Math.sqrt((h2 % 10000) / 10000) * scatter;
          const dx = Math.cos(angle) * dist;
          const dz = Math.sin(angle) * dist;
          const scale = 1.0 + ((h3 % 1000) / 1000) * 0.5;
          const dy = ((h1 % 400) / 1000) * 0.12;
          sprites.push(
            <sprite
              key={`${key}_m${i}`}
              position={[cx + dx, tile.height + 0.55 + dy, cz + dz]}
              scale={[scale, scale, 1]}
              raycast={() => null}
              renderOrder={MAP_ENTITY_RENDER_ORDER}
            >
              <spriteMaterial map={tex} {...MAP_ENTITY_SPRITE_MAT} />
            </sprite>,
          );
        }
        return sprites;
      })}
    </group>
  );
}

// ─── Resource deposits: see DepositHexDecals (flush hex-cap decals, not floating sprites) ──

// ─── Contested zone (between rivals) ───────────────────────────────

function ContestedZoneOverlay({ zoneKeys, tiles }: { zoneKeys: string[]; tiles: Map<string, Tile> }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const validTiles = useMemo(() => {
    return zoneKeys.map(k => tiles.get(k)).filter((t): t is Tile => !!t);
  }, [zoneKeys, tiles]);

  const geometry = useMemo(() => makeHexGeo(HEX_RADIUS * 0.99, 0.05), []);
  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: CONTESTED_ZONE_COLOR,
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
      }),
    [],
  );

  useEffect(() => {
    if (!meshRef.current || validTiles.length === 0) return;
    const mesh = meshRef.current;
    const dummy = new THREE.Object3D();
    validTiles.forEach((tile, i) => {
      const [x, z] = axialToWorld(tile.q, tile.r, HEX_RADIUS);
      dummy.position.set(x, tile.height + 0.03, z);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [validTiles]);

  if (validTiles.length === 0) return null;
  return (
    <instancedMesh ref={meshRef} args={[geometry, material, validTiles.length]} renderOrder={5} raycast={() => null} />
  );
}

/** Subtle tint per scroll terrain flavor (matches sprinkled tiles). */
function SpecialRegionOverlay({ tiles }: { tiles: Map<string, Tile> }) {
  const tilesByKind = useMemo(() => {
    const m = new Map<SpecialRegionKind, Tile[]>();
    for (const t of tiles.values()) {
      const k = t.specialTerrainKind;
      if (!k) continue;
      const arr = m.get(k) ?? [];
      arr.push(t);
      m.set(k, arr);
    }
    return m;
  }, [tiles]);

  const kinds: SpecialRegionKind[] = ['mexca', 'hills_lost', 'forest_secrets', 'isle_lost'];
  return (
    <group>
      {kinds.map(kind => {
        const list = tilesByKind.get(kind);
        if (!list?.length) return null;
        return (
          <SpecialRegionHexTint
            key={kind}
            tiles={list}
            color={SPECIAL_REGION_OVERLAY_COLORS[kind]}
          />
        );
      })}
    </group>
  );
}

function SpecialRegionHexTint({ tiles: regionTiles, color }: { tiles: Tile[]; color: string }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  /** Match biome paint decals (`defaultBiomePaintRadius`) so tint aligns with sr_* PNG caps. */
  const geometry = useMemo(() => makeHexGeo(defaultBiomePaintRadius(), 0.05), []);
  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.12,
        depthWrite: false,
      }),
    [color],
  );

  useEffect(() => {
    if (!meshRef.current || regionTiles.length === 0) return;
    const mesh = meshRef.current;
    const dummy = new THREE.Object3D();
    const yOff = 0.028;
    regionTiles.forEach((tile, i) => {
      const [x, z] = axialToWorld(tile.q, tile.r, HEX_RADIUS);
      dummy.position.set(x, tile.height + yOff, z);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [regionTiles]);

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, regionTiles.length]}
      renderOrder={SPECIAL_REGION_TINT_RENDER_ORDER}
      raycast={() => null}
    />
  );
}

// ─── Territory Overlay ─────────────────────────────────────────────

function TerritoryOverlay({ playerColor, tileKeys, tiles, isHuman }: {
  playerColor: string; tileKeys: string[]; tiles: Map<string, Tile>;
  /** Stronger tint + draw order so your land reads clearly vs AI. */
  isHuman?: boolean;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const validTiles = useMemo(() => {
    return tileKeys.map(k => tiles.get(k)).filter((t): t is Tile => !!t);
  }, [tileKeys, tiles]);

  const geometry = useMemo(() => makeHexGeo(HEX_RADIUS * 0.98, 0.04), []);
  const fillOpacity = isHuman ? 0.4 : 0.18;
  const material = useMemo(() => new THREE.MeshBasicMaterial({
    color: playerColor,
    transparent: true,
    opacity: fillOpacity,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  }), [playerColor, fillOpacity]);

  useEffect(() => {
    if (!meshRef.current || validTiles.length === 0) return;
    const mesh = meshRef.current;
    const dummy = new THREE.Object3D();
    validTiles.forEach((tile, i) => {
      const [x, z] = axialToWorld(tile.q, tile.r, HEX_RADIUS);
      dummy.position.set(x, tile.height + (isHuman ? 0.024 : 0.02), z);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [validTiles, isHuman]);

  if (validTiles.length === 0) return null;
  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, validTiles.length]}
      renderOrder={isHuman ? 5 : 3}
      raycast={() => null}
    />
  );
}

/** Territory border only: dashed segments on edges adjacent to non-owned hexes. */
function TerritoryDashedBorder({ playerColor, tileKeys, tiles, isHuman }: {
  playerColor: string;
  tileKeys: string[];
  tiles: Map<string, Tile>;
  isHuman?: boolean;
}) {
  const lineRef = useRef<THREE.LineSegments>(null);

  const geometry = useMemo(() => {
    const territorySet = new Set(tileKeys);
    const positions: number[] = [];
    const circum = HEX_RADIUS * 0.98;
    const halfEdge = circum * 0.5;

    for (const key of tileKeys) {
      const tile = tiles.get(key);
      if (!tile) continue;
      const { q, r: rr } = tile;
      const neighbors = hexNeighbors(q, rr);
      for (let i = 0; i < 6; i++) {
        const [nq, nr] = neighbors[i]!;
        const nk = tileKey(nq, nr);
        if (territorySet.has(nk)) continue;

        const [cx, cz] = axialToWorld(q, rr, HEX_RADIUS);
        const [nx, nz] = axialToWorld(nq, nr, HEX_RADIUS);
        const dx = nx - cx;
        const dz = nz - cz;
        const len = Math.hypot(dx, dz) || 1;
        const px = -dz / len;
        const pz = dx / len;
        const mx = (cx + nx) * 0.5;
        const mz = (cz + nz) * 0.5;
        const nTile = tiles.get(nk);
        const y = Math.max(tile.height, nTile?.height ?? 0) + (isHuman ? 0.045 : 0.035);

        positions.push(mx + px * halfEdge, y, mz + pz * halfEdge, mx - px * halfEdge, y, mz - pz * halfEdge);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    return geo;
  }, [tileKeys, tiles, isHuman]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  useLayoutEffect(() => {
    lineRef.current?.computeLineDistances();
  }, [geometry]);

  if (tileKeys.length === 0) return null;

  const dashSize = isHuman ? 0.26 : 0.16;
  const gapSize = isHuman ? 0.07 : 0.11;
  const lineOpacity = isHuman ? 1 : 0.72;

  return (
    <lineSegments
      ref={lineRef}
      geometry={geometry}
      renderOrder={isHuman ? 6 : 4}
      frustumCulled={false}
      raycast={() => null}
    >
      <lineDashedMaterial
        color={playerColor}
        transparent
        opacity={lineOpacity}
        dashSize={dashSize}
        gapSize={gapSize}
        depthWrite={false}
      />
    </lineSegments>
  );
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
          <sprite key={city.id} position={[x, h + 0.65, z]} scale={[1.6, 1.6, 1]} raycast={() => null} renderOrder={MAP_ENTITY_RENDER_ORDER}>
            <spriteMaterial
              map={tex}
              {...MAP_ENTITY_SPRITE_MAT}
              color={isHuman ? '#ffffff' : '#ff9999'}
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
  banana_farm: [1.2, 1.2],
  factory:     [1.1, 1.1],
  barracks:    [1.1, 1.1],
  academy:     [0.9, 1.2],
  market:      [1.2, 1.2],
  quarry:      [1.0, 1.0],
  mine:        [1.0, 1.0],
  gold_mine:   [1.0, 1.0],
  sawmill:     [1.0, 1.0],
  port:        [1.1, 1.1],
  shipyard:    [1.1, 1.1],
  fishery:     [1.1, 1.1],
  logging_hut: [1.0, 1.0],
};

const BUILDING_Y_OFFSET: Record<BuildingType, number> = {
  city_center: 0.50,
  farm:        0.45,
  banana_farm: 0.45,
  factory:     0.40,
  barracks:    0.40,
  academy:     0.55,
  market:      0.45,
  quarry:      0.40,
  mine:        0.40,
  gold_mine:   0.40,
  sawmill:     0.40,
  port:        0.45,
  shipyard:    0.42,
  fishery:     0.45,
  logging_hut: 0.40,
};

function BuildingMarkers({ cities, tiles }: { cities: City[]; tiles: Map<string, Tile> }) {
  const textures = useGameTextures(['farm', 'banana_farm', 'factory', 'city_center', 'barracks', 'academy', 'market', 'quarry', 'mine', 'gold_mine', 'sawmill', 'port', 'shipyard', 'fishery', 'logging_hut']);

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
          <sprite key={b.key} position={[b.x, b.y, b.z]} scale={[sx, sy, 1]} raycast={() => null} renderOrder={MAP_ENTITY_RENDER_ORDER}>
            <spriteMaterial map={tex} {...MAP_ENTITY_SPRITE_MAT} />
          </sprite>
        );
      })}
    </group>
  );
}

// ─── Unit HP Bars (floating above each army stack) ────────────────

function unitShownAsGarrisonSprite(u: Unit, cities: City[]): boolean {
  return cities.some(c => isGarrisonedAtCity(u, c));
}

function UnitHpBars({ units, tiles, cities }: { units: Unit[]; tiles: Map<string, Tile>; cities: City[] }) {
  const stacks = useMemo(() => {
    const byHex: Record<string, Unit[]> = {};
    for (const u of units) {
      if (u.hp <= 0 || u.aboardShipId || unitShownAsGarrisonSprite(u, cities)) continue;
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
  }, [units, cities]);

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

/** Progress toward destination + inter-hex step timer for moving stacks. */
function MovementProgressBars({ units, tiles, cities }: { units: Unit[]; tiles: Map<string, Tile>; cities: City[] }) {
  const stacks = useMemo(() => {
    const byHex: Record<string, Unit[]> = {};
    for (const u of units) {
      if (u.hp <= 0 || u.aboardShipId || unitShownAsGarrisonSprite(u, cities)) continue;
      if (u.status !== 'moving' || u.targetQ === undefined || u.targetR === undefined) continue;
      const key = tileKey(u.q, u.r);
      if (!byHex[key]) byHex[key] = [];
      byHex[key].push(u);
    }
    return Object.entries(byHex).map(([key, stackUnits]) => {
      const [q, r] = key.split(',').map(Number);
      return { key, q, r, lead: stackUnits[0] };
    });
  }, [units, cities]);

  if (stacks.length === 0) return null;

  return (
    <group>
      {stacks.map(s => (
        <MarchProgressStack key={s.key} q={s.q} r={s.r} lead={s.lead} tiles={tiles} />
      ))}
    </group>
  );
}

function MarchProgressStack({
  q, r, lead, tiles,
}: { q: number; r: number; lead: Unit; tiles: Map<string, Tile> }) {
  const [now, setNow] = useState(() => Date.now());
  useFrame(() => setNow(Date.now()));

  const tile = tiles.get(tileKey(q, r));
  const h = tile?.height ?? 0.3;
  const [x, z] = axialToWorld(q, r, HEX_RADIUS);
  const init = Math.max(1, lead.marchInitialHexDistance ?? 1);
  const rem = hexDistance(q, r, lead.targetQ!, lead.targetR!);
  const tripFill = Math.min(1, Math.max(0, 1 - rem / init));
  const leg = lead.moveLegMs ?? 0;
  const until = lead.nextMoveAt;
  let stepFill = 1;
  if (leg > 0 && until > 0 && now < until) {
    stepFill = Math.min(1, Math.max(0, 1 - (until - now) / leg));
  }

  return (
    <group position={[x, h + 1.38, z]}>
      <Html
        transform
        sprite
        scale={0.38}
        pointerEvents="none"
        style={{ pointerEvents: 'none', userSelect: 'none' }}
      >
        <div
          title="Top: progress along route · Bottom: time until next hex step"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '2px',
            whiteSpace: 'nowrap',
          }}
        >
          <span
            style={{
              fontSize: '9px',
              fontWeight: 700,
              fontFamily: 'monospace',
              color: '#9ddcff',
              textShadow: '0 0 4px #000, 0 0 2px #000',
              lineHeight: 1,
            }}
          >
            March
          </span>
          <div
            style={{
              width: '48px',
              height: '5px',
              background: '#111',
              borderRadius: '3px',
              overflow: 'hidden',
              border: '1px solid rgba(100,200,255,0.35)',
            }}
          >
            <div
              style={{
                width: `${tripFill * 100}%`,
                height: '100%',
                background: 'linear-gradient(90deg, #2dd4bf, #22c55e)',
                borderRadius: '3px',
              }}
            />
          </div>
          <div
            style={{
              width: '48px',
              height: '3px',
              background: '#0a1620',
              borderRadius: '2px',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${stepFill * 100}%`,
                height: '100%',
                background: '#6eb5ff',
                borderRadius: '2px',
              }}
            />
          </div>
        </div>
      </Html>
    </group>
  );
}

// ─── Unit Sprites ──────────────────────────────────────────────────

const UNIT_SPRITE_KEY: Record<string, string> = {
  infantry: 'infantry',
  cavalry: 'cavalry',
  ranged: 'archer',
  archer: 'archer',
  horse_archer: 'horse_archer',
  crusader_knight: 'crusader_knight',
  builder: 'builder',
  trebuchet: 'trebuchet',
  battering_ram: 'infantry', // placeholder until siege sprite exists
  defender: 'infantry', // reuse infantry sprite until defender.png exists
  scout_ship: 'scout_ship',
  warship: 'warship',
  transport_ship: 'transport_ship',
  fisher_transport: 'fisher_transport',
  capital_ship: 'capital_ship',
};

const COMBAT_FX_DURATION_MS = 480;

function hexElevWorld(q: number, r: number, tiles: Map<string, Tile>, yBoost: number): [number, number, number] {
  const t = tiles.get(tileKey(q, r));
  const h = t?.height ?? 0.3;
  const [x, z] = axialToWorld(q, r, HEX_RADIUS);
  return [x, h + yBoost, z];
}

function mortarArcPoints3(
  a: [number, number, number],
  b: [number, number, number],
): THREE.Vector3[] {
  const mid: [number, number, number] = [
    (a[0] + b[0]) / 2,
    Math.max(a[1], b[1]) + 1.05,
    (a[2] + b[2]) / 2,
  ];
  const out: THREE.Vector3[] = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    const u = 1 - t;
    out.push(
      new THREE.Vector3(
        u * u * a[0] + 2 * u * t * mid[0] + t * t * b[0],
        u * u * a[1] + 2 * u * t * mid[1] + t * t * b[1],
        u * u * a[2] + 2 * u * t * mid[2] + t * t * b[2],
      ),
    );
  }
  return out;
}

function MortarVolleyLines({
  fx,
  tiles,
  matLine,
  matSplash,
}: {
  fx: Extract<DefenseVolleyFx, { kind: 'mortar' | 'coastal_bombard' }>;
  tiles: Map<string, Tile>;
  matLine: THREE.LineBasicMaterial;
  matSplash: THREE.MeshBasicMaterial;
}) {
  const from = useMemo(() => hexElevWorld(fx.fromQ, fx.fromR, tiles, 0.52), [fx.fromQ, fx.fromR, tiles]);
  const primary = useMemo((): [number, number, number] | null => {
    if (fx.splashKeys.length === 0) return null;
    const [pq, pr] = parseTileKey(fx.splashKeys[0]);
    return hexElevWorld(pq, pr, tiles, 0.28);
  }, [fx.splashKeys, tiles]);

  const arcGeom = useMemo(() => {
    if (!primary) return null;
    const g = new THREE.BufferGeometry().setFromPoints(mortarArcPoints3(from, primary));
    return g;
  }, [from, primary]);

  const mortarTrail = useMemo(() => {
    if (!arcGeom) return null;
    return new THREE.Line(arcGeom, matLine);
  }, [arcGeom, matLine]);

  useEffect(() => {
    return () => {
      arcGeom?.dispose();
    };
  }, [arcGeom]);

  return (
    <group raycast={() => null}>
      {mortarTrail && <primitive object={mortarTrail} raycast={() => null} />}
      {fx.splashKeys.map(sk => {
        const [sq, sr] = parseTileKey(sk);
        const [x, y, z] = hexElevWorld(sq, sr, tiles, 0.22);
        return (
          <mesh key={sk} position={[x, y, z]} material={matSplash} raycast={() => null}>
            <sphereGeometry args={[0.34, 8, 6]} />
          </mesh>
        );
      })}
    </group>
  );
}

function TowerShotLine({
  fromQ,
  fromR,
  toQ,
  toR,
  tiles,
  material,
}: {
  fromQ: number;
  fromR: number;
  toQ: number;
  toR: number;
  tiles: Map<string, Tile>;
  material: THREE.LineBasicMaterial;
}) {
  const geom = useMemo(() => {
    const a = hexElevWorld(fromQ, fromR, tiles, 0.5);
    const b = hexElevWorld(toQ, toR, tiles, 0.36);
    return new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...a), new THREE.Vector3(...b)]);
  }, [fromQ, fromR, toQ, toR, tiles]);

  const seg = useMemo(() => new THREE.Line(geom, material), [geom, material]);

  useEffect(() => () => geom.dispose(), [geom]);

  return <primitive object={seg} raycast={() => null} />;
}

function UnitRangedShotLine({
  fx,
  tiles,
  material,
}: {
  fx: RangedShotFx;
  tiles: Map<string, Tile>;
  material: THREE.LineBasicMaterial;
}) {
  return (
    <TowerShotLine
      fromQ={fx.fromQ}
      fromR={fx.fromR}
      toQ={fx.toQ}
      toR={fx.toR}
      tiles={tiles}
      material={material}
    />
  );
}

function CombatShotEffects({ tiles }: { tiles: Map<string, Tile> }) {
  const lastAt = useGameStore(s => s.lastCombatFxAtMs);
  const defenseFx = useGameStore(s => s.lastDefenseVolleyFx);
  const rangedFx = useGameStore(s => s.lastRangedShotFx);

  const matMortar = useMemo(
    () => new THREE.LineBasicMaterial({ color: '#ff7722', transparent: true, depthWrite: false }),
    [],
  );
  const matArrow = useMemo(
    () => new THREE.LineBasicMaterial({ color: '#d4b896', transparent: true, depthWrite: false }),
    [],
  );
  const matBolt = useMemo(
    () => new THREE.LineBasicMaterial({ color: '#aab8c8', transparent: true, depthWrite: false }),
    [],
  );
  const matSplash = useMemo(
    () => new THREE.MeshBasicMaterial({ color: '#ff6611', transparent: true, depthWrite: false }),
    [],
  );
  const matCoastalLine = useMemo(
    () => new THREE.LineBasicMaterial({ color: '#6ec8e8', transparent: true, depthWrite: false }),
    [],
  );
  const matCoastalSplash = useMemo(
    () => new THREE.MeshBasicMaterial({ color: '#4a9ec4', transparent: true, depthWrite: false }),
    [],
  );

  useEffect(() => {
    return () => {
      matMortar.dispose();
      matArrow.dispose();
      matBolt.dispose();
      matSplash.dispose();
      matCoastalLine.dispose();
      matCoastalSplash.dispose();
    };
  }, [matMortar, matArrow, matBolt, matSplash, matCoastalLine, matCoastalSplash]);

  useFrame(() => {
    const age = lastAt ? Date.now() - lastAt : 99999;
    const op = age < COMBAT_FX_DURATION_MS ? Math.max(0, 1 - age / COMBAT_FX_DURATION_MS) : 0;
    matMortar.opacity = op * 0.92;
    matArrow.opacity = op * 0.88;
    matBolt.opacity = op * 0.88;
    matSplash.opacity = op * 0.42;
    matCoastalLine.opacity = op * 0.9;
    matCoastalSplash.opacity = op * 0.38;
  });

  if (defenseFx.length === 0 && rangedFx.length === 0) return null;

  return (
    <group raycast={() => null}>
      {defenseFx.map((fx, i) => {
        if (fx.kind === 'mortar') {
          return (
            <MortarVolleyLines key={`mv-${i}`} fx={fx} tiles={tiles} matLine={matMortar} matSplash={matSplash} />
          );
        }
        if (fx.kind === 'coastal_bombard') {
          return (
            <MortarVolleyLines
              key={`cb-${i}`}
              fx={fx}
              tiles={tiles}
              matLine={matCoastalLine}
              matSplash={matCoastalSplash}
            />
          );
        }
        const mat = fx.kind === 'ballista' ? matBolt : matArrow;
        return (
          <TowerShotLine
            key={`tv-${i}-${fx.kind}`}
            fromQ={fx.fromQ}
            fromR={fx.fromR}
            toQ={fx.targetQ}
            toR={fx.targetR}
            tiles={tiles}
            material={mat}
          />
        );
      })}
      {rangedFx.map((fx, i) => (
        <UnitRangedShotLine key={`rs-${i}-${fx.attackerId}`} fx={fx} tiles={tiles} material={matArrow} />
      ))}
    </group>
  );
}

function isBowUnitMarkerType(type: string): boolean {
  return type === 'ranged' || type === 'horse_archer';
}

function BowUnitSprite({
  id,
  type,
  x,
  y,
  z,
  tint,
  sx,
  sy,
  tex,
}: {
  id: string;
  type: string;
  x: number;
  y: number;
  z: number;
  tint: string;
  sx: number;
  sy: number;
  tex: THREE.Texture;
}) {
  const ref = useRef<THREE.Sprite>(null);
  const lastFxAt = useGameStore(s => s.lastCombatFxAtMs);
  const shooterIds = useGameStore(s => s.rangedShooterUnitIds);

  useFrame(() => {
    if (!ref.current || !isBowUnitMarkerType(type)) return;
    const pulse =
      lastFxAt > 0 &&
      shooterIds.includes(id) &&
      Date.now() - lastFxAt < 380;
    const t = pulse ? (Date.now() - lastFxAt) / 380 : 1;
    const bump = pulse ? 1 + 0.14 * Math.sin(Math.min(t, 1) * Math.PI) : 1;
    ref.current.scale.set(sx * bump, sy * bump, 1);
  });

  return (
    <sprite ref={ref} position={[x, y, z]} scale={[sx, sy, 1]} raycast={() => null} renderOrder={MAP_ENTITY_RENDER_ORDER}>
      <spriteMaterial map={tex} {...MAP_ENTITY_SPRITE_MAT} color={tint} />
    </sprite>
  );
}

/** Naval units: gentle water bob when idle; stronger roll + sway + bob when marching. */
function ShipUnitSprite({
  id,
  q,
  r,
  x,
  y,
  z,
  tint,
  sx,
  sy,
  tex,
  moving,
}: {
  id: string;
  q: number;
  r: number;
  x: number;
  y: number;
  z: number;
  tint: string;
  sx: number;
  sy: number;
  tex: THREE.Texture;
  moving: boolean;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const spriteRef = useRef<THREE.Sprite>(null);
  const selectHex = useGameStore(s => s.selectHex);
  const phase = useMemo(() => {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
    return (h & 0xffff) * 0.001;
  }, [id]);

  useFrame(({ clock }) => {
    if (!groupRef.current || !spriteRef.current) return;
    const t = clock.getElapsedTime();
    const mv = moving;
    const freq = mv ? 5.1 : 1.55;
    const rollAmp = mv ? 0.13 : 0.038;
    const bobAmp = mv ? 0.062 : 0.024;
    const swayAmp = mv ? 0.045 : 0.014;
    const roll = Math.sin(t * freq + phase) * rollAmp;
    const bob = Math.sin(t * freq * 1.67 + phase * 1.2) * bobAmp;
    const sway = Math.sin(t * freq * 0.88 + phase * 0.7) * swayAmp;
    spriteRef.current.rotation.z = roll;
    groupRef.current.position.set(x + sway, y + bob, z);
  });

  return (
    <group ref={groupRef} position={[x, y, z]} renderOrder={MAP_ENTITY_RENDER_ORDER}>
      <sprite
        ref={spriteRef}
        scale={[sx, sy, 1]}
        renderOrder={MAP_ENTITY_RENDER_ORDER}
        onClick={e => {
          e.stopPropagation();
          selectHex(q, r);
        }}
      >
        <spriteMaterial map={tex} {...MAP_ENTITY_SPRITE_MAT} color={tint} />
      </sprite>
    </group>
  );
}

const UNIT_SPRITE_SCALE: Record<string, [number, number]> = {
  infantry: [1.1, 1.1],
  cavalry:  [1.3, 1.3],
  ranged:   [1.1, 1.1],
  archer:   [1.1, 1.1],
  builder:  [1.0, 1.0],
  trebuchet: [1.2, 1.2],
  battering_ram: [1.2, 1.2],
  defender: [1.1, 1.1],
  scout_ship: [1.2, 1.2],
  warship: [1.3, 1.3],
  transport_ship: [1.25, 1.25],
  fisher_transport: [1.0, 1.0],
  capital_ship: [1.35, 1.35],
  horse_archer: [1.25, 1.25],
  crusader_knight: [1.15, 1.15],
};

function UnitMarkers({ units, tiles, cities }: { units: Unit[]; tiles: Map<string, Tile>; cities: City[] }) {
  const textures = useGameTextures([
    'infantry', 'cavalry', 'archer', 'horse_archer', 'crusader_knight', 'builder', 'trebuchet', 'defender',
    'scout_ship', 'warship', 'transport_ship', 'fisher_transport', 'capital_ship',
  ]);

  const positioned = useMemo(() => {
    const hexCount = new Map<string, number>();
    return units.filter(u => u.hp > 0 && !u.aboardShipId && !unitShownAsGarrisonSprite(u, cities)).map(u => {
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
        id: u.id,
        type: u.type,
        q: u.q,
        r: u.r,
        x: x + offset * 0.3,
        y: h + 0.55,
        z: z - offset * 0.2,
        tint: tintColor,
        moving: u.status === 'moving',
      };
    });
  }, [units, tiles, cities]);

  if (positioned.length === 0) return null;
  return (
    <group>
      {positioned.map(u => {
        const spriteKey = UNIT_SPRITE_KEY[u.type] ?? u.type;
        const tex = textures[spriteKey];
        const [sx, sy] = UNIT_SPRITE_SCALE[u.type] ?? [1.0, 1.0];
        if (isBowUnitMarkerType(u.type)) {
          return (
            <BowUnitSprite
              key={u.id}
              id={u.id}
              type={u.type}
              x={u.x}
              y={u.y}
              z={u.z}
              tint={u.tint}
              sx={sx}
              sy={sy}
              tex={tex}
            />
          );
        }
        if (isNavalUnitType(u.type)) {
          return (
            <ShipUnitSprite
              key={u.id}
              id={u.id}
              q={u.q}
              r={u.r}
              x={u.x}
              y={u.y}
              z={u.z}
              tint={u.tint}
              sx={sx}
              sy={sy}
              tex={tex}
              moving={u.moving}
            />
          );
        }
        return (
          <sprite key={u.id} position={[u.x, u.y, u.z]} scale={[sx, sy, 1]} raycast={() => null} renderOrder={MAP_ENTITY_RENDER_ORDER}>
            <spriteMaterial map={tex} {...MAP_ENTITY_SPRITE_MAT} color={u.tint} />
          </sprite>
        );
      })}
    </group>
  );
}

/** Single badge on city hex for garrisoned land armies (individual sprites hidden). */
function GarrisonBadges({ cities, units, tiles }: { cities: City[]; units: Unit[]; tiles: Map<string, Tile> }) {
  const badges = useMemo(() => {
    const out: { key: string; q: number; r: number; count: number; totalHp: number; totalMax: number; isHuman: boolean }[] = [];
    for (const city of cities) {
      const garr = units.filter(u => isGarrisonedAtCity(u, city) && u.hp > 0);
      if (garr.length === 0) continue;
      let totalHp = 0, totalMax = 0;
      for (const u of garr) {
        totalHp += u.hp;
        totalMax += u.maxHp;
      }
      out.push({
        key: city.id,
        q: city.q,
        r: city.r,
        count: garr.length,
        totalHp,
        totalMax,
        isHuman: city.ownerId.includes('human'),
      });
    }
    return out;
  }, [cities, units]);

  if (badges.length === 0) return null;

  return (
    <group>
      {badges.map(b => {
        const tile = tiles.get(tileKey(b.q, b.r));
        const h = tile?.height ?? 0.3;
        const [x, z] = axialToWorld(b.q, b.r, HEX_RADIUS);
        const ratio = b.totalMax > 0 ? b.totalHp / b.totalMax : 0;
        const barColor = ratio > 0.6 ? '#22c55e' : ratio > 0.3 ? '#eab308' : '#ef4444';
        return (
          <group key={b.key} position={[x, h + 1.05, z]}>
            <Html transform sprite scale={0.42} pointerEvents="none" style={{ pointerEvents: 'none', userSelect: 'none' }}>
              <div style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px',
                padding: '2px 6px', borderRadius: '6px',
                background: b.isHuman ? 'rgba(20,40,60,0.85)' : 'rgba(60,20,20,0.85)',
                border: `1px solid ${b.isHuman ? 'rgba(100,180,255,0.5)' : 'rgba(255,120,100,0.5)'}`,
              }}>
                <span style={{
                  fontSize: '11px', fontWeight: 800, fontFamily: 'system-ui,sans-serif',
                  color: '#f5e6c8', textShadow: '0 1px 2px #000',
                }}>
                  Garrison {b.count}
                </span>
                <span style={{ fontSize: '9px', fontWeight: 700, color: barColor, fontFamily: 'monospace' }}>
                  {b.totalHp} HP
                </span>
                <div style={{
                  width: '44px', height: '4px', background: '#111', borderRadius: '2px', overflow: 'hidden',
                }}>
                  <div style={{ width: `${ratio * 100}%`, height: '100%', background: barColor, borderRadius: '2px' }} />
                </div>
              </div>
            </Html>
          </group>
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
          <sprite key={h.id} position={[x, ht + 0.75, z]} scale={[1.2, 1.2, 1]} raycast={() => null} renderOrder={MAP_ENTITY_RENDER_ORDER}>
            <spriteMaterial map={tex} {...MAP_ENTITY_SPRITE_MAT} />
          </sprite>
        );
      })}
    </group>
  );
}

function CommanderMarkers({ commanders, tiles }: { commanders: Commander[]; tiles: Map<string, Tile> }) {
  if (commanders.length === 0) return null;
  return (
    <group>
      {commanders.map(c => {
        const tile = tiles.get(tileKey(c.q, c.r));
        const ht = tile?.height ?? 0.3;
        const [x, z] = axialToWorld(c.q, c.r, HEX_RADIUS);
        return (
          <group key={c.id} position={[x + 0.42, ht + 0.88, z - 0.15]}>
            <Html transform sprite scale={0.38} pointerEvents="none" center style={{ pointerEvents: 'none' }}>
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 8,
                  overflow: 'hidden',
                  border: '2px solid #c9a227',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.65)',
                  background: '#1a1520',
                }}
              >
                {c.portraitDataUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={c.portraitDataUrl}
                    width={44}
                    height={44}
                    alt=""
                    style={{ display: 'block', imageRendering: 'pixelated' }}
                  />
                ) : (
                  <div style={{ width: 44, height: 44, background: '#334155' }} />
                )}
              </div>
            </Html>
          </group>
        );
      })}
    </group>
  );
}

// ─── Scout Tower Markers ─────────────────────────────────────────────

function ScoutTowerMarkers({ scoutTowers: towers, tiles, players }: { scoutTowers: ScoutTower[]; tiles: Map<string, Tile>; players: { id: string; color: string }[] }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const geo = useMemo(() => new THREE.CylinderGeometry(0.2, 0.28, 0.5, 6), []);
  const material = useMemo(() => new THREE.MeshLambertMaterial({ color: '#66aacc', emissive: '#224466', emissiveIntensity: 0.3 }), []);

  useEffect(() => {
    if (!meshRef.current || towers.length === 0) return;
    const mesh = meshRef.current;
    const dummy = new THREE.Object3D();
    towers.forEach((t, i) => {
      const tile = tiles.get(tileKey(t.q, t.r));
      const h = tile?.height ?? 0.3;
      const [x, z] = axialToWorld(t.q, t.r, HEX_RADIUS);
      dummy.position.set(x, h + 0.35, z);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [towers, tiles]);

  if (towers.length === 0) return null;
  return (
    <instancedMesh ref={meshRef} args={[geo, material, towers.length]} renderOrder={MAP_ENTITY_RENDER_ORDER} />
  );
}

const DEFENSE_SPRITE_KEY: Record<DefenseTowerType, string> = {
  mortar: 'defense_mortar',
  archer_tower: 'defense_archer_tower',
  ballista: 'defense_ballista',
};

const DEFENSE_SPRITE_SCALE: Record<DefenseTowerType, [number, number]> = {
  mortar: [1.05, 1.05],
  archer_tower: [1.1, 1.15],
  ballista: [1.05, 1.08],
};

function CityDefenseMarkers({
  installations,
  tiles,
  players,
}: {
  installations: DefenseInstallation[];
  tiles: Map<string, Tile>;
  players: { id: string; color: string }[];
}) {
  const textures = useGameTextures(['defense_mortar', 'defense_archer_tower', 'defense_ballista']);

  const positioned = useMemo(() => {
    return installations.map(d => {
      const tile = tiles.get(tileKey(d.q, d.r));
      const h = tile?.height ?? 0.3;
      const [x, z] = axialToWorld(d.q, d.r, HEX_RADIUS);
      const yOff = 0.48 + (d.level - 1) * 0.035;
      const playerColor = players.find(p => p.id === d.ownerId)?.color ?? '#ffffff';
      return {
        id: d.id,
        type: d.type,
        level: d.level,
        x,
        y: h + yOff,
        z,
        playerColor,
      };
    });
  }, [installations, tiles, players]);

  if (positioned.length === 0) return null;
  return (
    <group>
      {positioned.map(d => {
        const spriteKey = DEFENSE_SPRITE_KEY[d.type];
        const tex = textures[spriteKey];
        const [sx, sy] = DEFENSE_SPRITE_SCALE[d.type];
        const lm = 0.92 + d.level * 0.025;
        return (
          <sprite key={d.id} position={[d.x, d.y, d.z]} scale={[sx * lm, sy * lm, 1]} raycast={() => null} renderOrder={MAP_ENTITY_RENDER_ORDER}>
            <spriteMaterial map={tex} {...MAP_ENTITY_SPRITE_MAT} color={d.playerColor} />
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
  return (
    <instancedMesh ref={meshRef} args={[geometry, material, sites.length]} renderOrder={MAP_ENTITY_RENDER_ORDER} />
  );
}

// ─── Builder at Construction Sites ──────────────────────────────────

function BuilderAtSiteMarkers({ sites, roadSites, tiles }: {
  sites: ConstructionSite[];
  roadSites: RoadConstructionSite[];
  tiles: Map<string, Tile>;
}) {
  const tex = useMemo(() => getSpriteTexture('builder'), []);
  const allHexes = useMemo(() => {
    const seen = new Set<string>();
    const out: { q: number; r: number }[] = [];
    for (const s of sites) {
      const k = tileKey(s.q, s.r);
      if (!seen.has(k)) { seen.add(k); out.push(s); }
    }
    for (const r of roadSites) {
      const k = tileKey(r.q, r.r);
      if (!seen.has(k)) { seen.add(k); out.push(r); }
    }
    return out;
  }, [sites, roadSites]);

  if (allHexes.length === 0) return null;
  return (
    <group>
      {allHexes.map(site => {
        const tile = tiles.get(tileKey(site.q, site.r));
        if (!tile) return null;
        const [x, z] = axialToWorld(site.q, site.r, HEX_RADIUS);
        const ox = HEX_RADIUS * 0.35;
        return (
          <sprite
            key={`bldr_${tileKey(site.q, site.r)}`}
            position={[x + ox, tile.height + 0.45, z]}
            scale={[0.8, 0.8, 1]}
            raycast={() => null}
            renderOrder={MAP_ENTITY_RENDER_ORDER}
          >
            <spriteMaterial map={tex} {...MAP_ENTITY_SPRITE_MAT} />
          </sprite>
        );
      })}
    </group>
  );
}

// ─── Move Range Highlight ───────────────────────────────────────────

const MOVE_RADIUS = MOVE_ORDER_MAX_IN_TERRITORY_BAND;

function MoveRangeOverlay({ fromQ, fromR, tiles, color = '#44ff88', naval = false }: {
  fromQ: number; fromR: number; tiles: Map<string, Tile>; color?: string; naval?: boolean;
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
        if (!tile) continue;
        if (naval) {
          if (tile.biome === 'water') result.push(tile);
        } else if (tile.biome !== 'water') {
          result.push(tile);
        }
      }
    }
    return result;
  }, [fromQ, fromR, tiles, naval]);

  const geometry = useMemo(() => makeHexGeo(HEX_RADIUS * HEX_INNER_RATIO * 0.95, 0.03), []);
  const material = useMemo(() => new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.22, depthWrite: false,
  }), [color]);

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

function MultiStackMoveRangeOverlay({ stackKeys, tiles, color }: { stackKeys: string[]; tiles: Map<string, Tile>; color?: string }) {
  return (
    <>
      {stackKeys.map(sk => {
        const [fq, fr] = sk.split(',').map(Number);
        return <MoveRangeOverlay key={sk} fromQ={fq} fromR={fr} tiles={tiles} color={color ?? '#e4b44c'} />;
      })}
    </>
  );
}

/** Flat tint on specific tiles (tactical order hints / pending targets). */
function TacticalOrderTilesOverlay({ tiles: tileList, color, opacity = 0.28 }: { tiles: Tile[]; color: string; opacity?: number }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const geometry = useMemo(() => makeHexGeo(HEX_RADIUS * HEX_INNER_RATIO * 0.92, 0.04), []);
  const material = useMemo(() => new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, depthWrite: false,
  }), [color, opacity]);

  useEffect(() => {
    if (!meshRef.current || tileList.length === 0) return;
    const mesh = meshRef.current;
    const dummy = new THREE.Object3D();
    tileList.forEach((tile, i) => {
      const [x, z] = axialToWorld(tile.q, tile.r, HEX_RADIUS);
      dummy.position.set(x, tile.height + 0.055, z);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.count = tileList.length;
  }, [tileList]);

  if (tileList.length === 0) return null;
  return <instancedMesh ref={meshRef} args={[geometry, material, Math.max(1, tileList.length)]} renderOrder={6} raycast={() => null} />;
}

function defenseTowerRangeTiles(q: number, r: number, towerType: DefenseTowerType, tiles: Map<string, Tile>): Tile[] {
  const range = towerType === 'mortar' ? DEFENSE_TOWER_MORTAR_RANGE : DEFENSE_TOWER_ARCHER_RANGE;
  const out: Tile[] = [];
  tiles.forEach(t => {
    if (hexDistance(q, r, t.q, t.r) <= range) out.push(t);
  });
  return out;
}

/** Green hex tint — weapon range when a city defense tower hex is selected. */
function SelectedDefenseTowerRangeOverlay({
  installation,
  tiles,
}: {
  installation: DefenseInstallation;
  tiles: Map<string, Tile>;
}) {
  const tileList = useMemo(
    () => defenseTowerRangeTiles(installation.q, installation.r, installation.type, tiles),
    [installation.q, installation.r, installation.type, tiles],
  );
  return <TacticalOrderTilesOverlay tiles={tileList} color="#22c55e" opacity={0.2} />;
}

// ─── Deposit Highlight (Mine/Quarry build mode) ─────────────────────

function DepositHighlightOverlay({ tiles, cities, constructions, depositType }: {
  tiles: Map<string, Tile>;
  cities: City[];
  constructions: ConstructionSite[];
  depositType: 'mine' | 'quarry' | 'gold_mine' | 'logging_hut';
}) {
  const hexes = useMemo(() => {
    const result: Tile[] = [];
    const hasBuilding = (q: number, r: number) =>
      cities.some(c => c.buildings.some(b => tileKey(b.q, b.r) === tileKey(q, r)));
    const hasConstruction = (q: number, r: number) =>
      constructions.some(cs => cs.q === q && cs.r === r);
    tiles.forEach(tile => {
      if (tile.biome === 'water') return;
      if (depositType !== 'gold_mine' && depositType !== 'logging_hut' && tile.biome === 'mountain') return;
      const match = depositType === 'mine' ? tile.hasMineDeposit : depositType === 'quarry' ? tile.hasQuarryDeposit : depositType === 'logging_hut' ? tile.biome === 'forest' : tile.hasGoldMineDeposit;
      if (!match || hasBuilding(tile.q, tile.r) || hasConstruction(tile.q, tile.r)) return;
      result.push(tile);
    });
    return result;
  }, [tiles, cities, constructions, depositType]);

  const highlightColor = depositType === 'mine' ? '#b45309' : depositType === 'quarry' ? QUARRY_DEPOSIT_COLOR : depositType === 'logging_hut' ? WOOD_DEPOSIT_COLOR : GOLD_MINE_DEPOSIT_COLOR;
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
      <ringGeometry args={[HEX_RADIUS * 0.88, HEX_RADIUS * 0.97, 6]} />
      <meshBasicMaterial color="#e8dc7a" transparent opacity={0.55} depthWrite={false} side={THREE.DoubleSide} />
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
      <ringGeometry args={[HEX_RADIUS * 0.72, HEX_RADIUS * 0.97, 6]} />
      <meshBasicMaterial color="#5ecf7a" transparent opacity={0.62} depthWrite={false} side={THREE.DoubleSide} />
    </mesh>
  );
}

// ─── Battle Icons (animated crossed-swords on contested hexes) ────

function BattleIcons({ units, tiles }: { units: Unit[]; tiles: Map<string, Tile> }) {
  const groupRef = useRef<THREE.Group>(null);
  const battleModalHexKey = useGameStore(s => s.battleModalHexKey);
  const openBattleModal = useGameStore(s => s.openBattleModal);

  const battleHexes = useMemo(() => {
    const byHex: Record<string, Set<string>> = {};
    for (const u of units) {
      if (u.hp <= 0 || u.aboardShipId) continue;
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
    <group ref={groupRef} renderOrder={MAP_ENTITY_RENDER_ORDER}>
      {battleHexes.map(({ q, r }) => {
        const tile = tiles.get(tileKey(q, r));
        const h = tile?.height ?? 0.3;
        const [x, z] = axialToWorld(q, r, HEX_RADIUS);
        const baseY = h + 1.0;
        const k = tileKey(q, r);
        const selected = battleModalHexKey === k;
        return (
          <group
            key={`battle-${q},${r}`}
            position={[x, baseY, z]}
            userData={{ baseY }}
            onClick={e => {
              e.stopPropagation();
              openBattleModal(k);
            }}
          >
            <mesh position={[0, -0.92, 0]} rotation={[-Math.PI / 2, 0, Math.PI / 6]}>
              <ringGeometry args={[HEX_RADIUS * 0.55, HEX_RADIUS * 0.92, 6]} />
              <meshBasicMaterial
                color={selected ? '#e8c84a' : '#cc2222'}
                transparent
                opacity={selected ? 0.85 : 0.5}
                depthWrite={false}
              />
            </mesh>
            {/* Sword 1 (leaning right) */}
            <mesh rotation={[0, 0, Math.PI / 6]} position={[-0.08, 0, 0]}>
              <boxGeometry args={[0.04, 0.45, 0.04]} />
              <meshBasicMaterial color={selected ? '#ffcc66' : '#ff4444'} />
            </mesh>
            {/* Sword 2 (leaning left) */}
            <mesh rotation={[0, 0, -Math.PI / 6]} position={[0.08, 0, 0]}>
              <boxGeometry args={[0.04, 0.45, 0.04]} />
              <meshBasicMaterial color={selected ? '#ffcc66' : '#ff4444'} />
            </mesh>
            {/* Flash/glow sphere */}
            <mesh>
              <sphereGeometry args={[0.16, 10, 10]} />
              <meshBasicMaterial color={selected ? '#ffaa33' : '#ff2200'} transparent opacity={selected ? 0.45 : 0.35} />
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
  const commanders = useGameStore(s => s.commanders);
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
  const wallSections = useGameStore(s => s.wallSections);
  const scoutTowers = useGameStore(s => s.scoutTowers);
  const defenseInstallations = useGameStore(s => s.defenseInstallations);
  const supplyViewTab = useGameStore(s => s.supplyViewTab);
  const getSupplyClustersWithHealth = useGameStore(s => s.getSupplyClustersWithHealth);
  const assigningTacticalForStack = useGameStore(s => s.assigningTacticalForStack);
  const assigningTacticalForSelectedStacks = useGameStore(s => s.assigningTacticalForSelectedStacks);
  const pendingTacticalOrders = useGameStore(s => s.pendingTacticalOrders);
  const contestedZoneHexKeys = useGameStore(s => s.contestedZoneHexKeys);
  const territoryDisplayStyle = useGameStore(s => s.territoryDisplayStyle);

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

  const mapShoreline = useMemo(() => {
    const coastalWater: Tile[] = [];
    const deepWater: Tile[] = [];
    const beachLand: Tile[] = [];
    for (const t of tiles.values()) {
      if (t.biome === 'water') {
        if (isCoastalWaterTile(t, tiles)) coastalWater.push(t);
        else deepWater.push(t);
      } else if (isBeachLandTile(t, tiles)) {
        beachLand.push(t);
      }
    }
    return { coastalWater, deepWater, beachLand };
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

  /** Draw AI first so human fill + dashed border win at shared edges. */
  const playersTerritoryRenderOrder = useMemo(() => {
    const list = [...players];
    list.sort((a, b) => {
      if (a.id === PLAYER_HUMAN_ID) return 1;
      if (b.id === PLAYER_HUMAN_ID) return -1;
      return 0;
    });
    return list;
  }, [players]);

  // Two-tier vision: everything is always visible (terrain, cities, buildings, territory).
  // Only ENEMY UNITS and HEROES are hidden unless within active vision range.
  const visibleUnits = useMemo(() => {
    const noPassengers = units.filter(u => !u.aboardShipId);
    if (!visionActive) return noPassengers;
    return noPassengers.filter(u => {
      if (u.ownerId.includes('human')) return true;
      return visibleHexes.has(tileKey(u.q, u.r));
    });
  }, [units, visionActive, visibleHexes]);

  const moveRangeNaval = useMemo(() => {
    if (uiMode !== 'move' || !selectedHex) return false;
    const stack = units.filter(
      u => u.q === selectedHex.q && u.r === selectedHex.r && u.ownerId.includes('human') && u.hp > 0 && !u.aboardShipId,
    );
    return stack.length > 0 && stack.every(u => isNavalUnitType(u.type));
  }, [uiMode, selectedHex, units]);

  const visibleHeroes = useMemo(() => {
    if (!visionActive) return heroes;
    return heroes.filter(h => {
      if (h.ownerId.includes('human')) return true;
      return visibleHexes.has(tileKey(h.q, h.r));
    });
  }, [heroes, visionActive, visibleHexes]);

  const visibleCommanders = useMemo(() => {
    if (!visionActive) return commanders;
    return commanders.filter(c => {
      if (c.ownerId.includes('human')) return true;
      return visibleHexes.has(tileKey(c.q, c.r));
    });
  }, [commanders, visionActive, visibleHexes]);

  const tacticalIncorporateHintTiles = useMemo(() => {
    if (assigningTacticalForSelectedStacks?.orderType !== 'incorporate_village') return [];
    const cityHex = new Set(cities.map(c => tileKey(c.q, c.r)));
    return Array.from(tiles.values()).filter(
      t => t.hasVillage && t.biome !== 'water' && !cityHex.has(tileKey(t.q, t.r)),
    );
  }, [assigningTacticalForSelectedStacks, tiles, cities]);

  const tacticalPendingIncorporateTiles = useMemo(() => {
    if (!pendingTacticalOrders) return [];
    const out: Tile[] = [];
    const seen = new Set<string>();
    for (const o of Object.values(pendingTacticalOrders)) {
      if (!o || o.type !== 'incorporate_village' || o.toQ === undefined || o.toR === undefined) continue;
      const k = tileKey(o.toQ, o.toR);
      if (seen.has(k)) continue;
      seen.add(k);
      const t = tiles.get(k);
      if (t) out.push(t);
    }
    return out;
  }, [pendingTacticalOrders, tiles]);

  const tacticalAttackHintTiles = useMemo(() => {
    if (assigningTacticalForSelectedStacks?.orderType !== 'attack_city') return [];
    return cities
      .filter(c => c.ownerId !== PLAYER_HUMAN_ID)
      .map(c => tiles.get(tileKey(c.q, c.r)))
      .filter((t): t is Tile => !!t);
  }, [assigningTacticalForSelectedStacks, cities, tiles]);

  const tacticalPendingAttackTiles = useMemo(() => {
    if (!pendingTacticalOrders) return [];
    const seen = new Set<string>();
    const out: Tile[] = [];
    for (const o of Object.values(pendingTacticalOrders)) {
      if (!o || o.type !== 'attack_city' || !o.cityId) continue;
      const c = cities.find(x => x.id === o.cityId);
      if (!c) continue;
      const k = tileKey(c.q, c.r);
      if (seen.has(k)) continue;
      seen.add(k);
      const t = tiles.get(k);
      if (t) out.push(t);
    }
    return out;
  }, [pendingTacticalOrders, cities, tiles]);

  const tacticalDefendHintTiles = useMemo(() => {
    if (assigningTacticalForSelectedStacks?.orderType !== 'defend_pick') return [];
    return cities
      .filter(c => c.ownerId === PLAYER_HUMAN_ID)
      .map(c => tiles.get(tileKey(c.q, c.r)))
      .filter((t): t is Tile => !!t);
  }, [assigningTacticalForSelectedStacks, cities, tiles]);

  const tacticalPendingDefendTiles = useMemo(() => {
    if (!pendingTacticalOrders) return [];
    const seen = new Set<string>();
    const out: Tile[] = [];
    for (const o of Object.values(pendingTacticalOrders)) {
      if (!o || o.type !== 'defend' || !o.cityId) continue;
      const c = cities.find(x => x.id === o.cityId);
      if (!c || c.ownerId !== PLAYER_HUMAN_ID) continue;
      const k = tileKey(c.q, c.r);
      if (seen.has(k)) continue;
      seen.add(k);
      const t = tiles.get(k);
      if (t) out.push(t);
    }
    return out;
  }, [pendingTacticalOrders, cities, tiles]);

  const selectedDefenseInstallation = useMemo(() => {
    if (!selectedHex || phase !== 'playing') return null;
    return defenseInstallations.find(d => d.q === selectedHex.q && d.r === selectedHex.r) ?? null;
  }, [selectedHex, defenseInstallations, phase]);

  return (
    <group>
      {/* Terrain */}
      {(Object.entries(biomeGroups.groups) as [Biome, Tile[]][]).map(([biome, bTiles]) => (
        <TerrainLayer key={biome} tiles={bTiles} biome={biome} />
      ))}
      <DeepWaterVariantLayers tiles={mapShoreline.deepWater} />
      <BiomeTextureLayer tiles={mapShoreline.coastalWater} textureKey="biome_water_coast" />
      <LandBiomeVariantLayers tiles={biomeGroups.groups.plains} biome="plains" />
      <LandBiomeVariantLayers tiles={biomeGroups.groups.forest} biome="forest" />
      <LandBiomeVariantLayers tiles={biomeGroups.groups.mountain} biome="mountain" />
      <LandBiomeVariantLayers tiles={biomeGroups.groups.desert} biome="desert" />
      <BeachSandLayer tiles={mapShoreline.beachLand} />
      <MedievalHexOutlineLayer tiles={Array.from(tiles.values())} />
      <MountainSnowLayer tiles={biomeGroups.groups.mountain} tilesMap={tiles} />

      {/* Map features */}
      <RoadOverlay tiles={biomeGroups.roadTiles} />
      <RoadConstructionOverlay sites={roadConstructions} tiles={tiles} />
      <WallOverlay wallSections={wallSections} tiles={tiles} players={players} />
      <RuinSpriteLayer tiles={biomeGroups.ruinTiles} />

      {/* Resource deposits — billboard sprites above terrain */}
      <DepositSpriteLayer tiles={tiles} />
      {phase === 'playing' && (
        <>
          {/* Tint below PNG decals (renderOrder); sprites/units use MAP_ENTITY_RENDER_ORDER above both */}
          <SpecialRegionOverlay tiles={tiles} />
          <SpecialRegionTextureDecals tiles={tiles} />
        </>
      )}

      {/* Territory overlays (always visible); human drawn last for clearer borders */}
      {playersTerritoryRenderOrder.map(p => (
        territoryByPlayer[p.id] && (
          territoryDisplayStyle === 'fill' ? (
            <TerritoryOverlay
              key={p.id}
              playerColor={p.color}
              tileKeys={territoryByPlayer[p.id]}
              tiles={tiles}
              isHuman={p.id === PLAYER_HUMAN_ID}
            />
          ) : (
            <TerritoryDashedBorder
              key={p.id}
              playerColor={p.color}
              tileKeys={territoryByPlayer[p.id]}
              tiles={tiles}
              isHuman={p.id === PLAYER_HUMAN_ID}
            />
          )
        )
      ))}

      {contestedZoneHexKeys.length > 0 && phase === 'playing' && (
        <ContestedZoneOverlay zoneKeys={contestedZoneHexKeys} tiles={tiles} />
      )}

      <VillageLayer tiles={biomeGroups.villageTiles} />
      <ForestTreeLayer tiles={biomeGroups.groups.forest} />
      <MountainPeakLayer tiles={biomeGroups.groups.mountain} />

      {/* Game entities — cities/buildings always visible, units/heroes vision-filtered */}
      <CityMarkers cities={cities} tiles={tiles} />
      <BuildingMarkers cities={cities} tiles={tiles} />
      <ConstructionMarkers sites={constructions} tiles={tiles} />
      <BuilderAtSiteMarkers sites={constructions} roadSites={roadConstructions} tiles={tiles} />
      <ScoutTowerMarkers scoutTowers={scoutTowers} tiles={tiles} players={players} />
      <CityDefenseMarkers installations={defenseInstallations} tiles={tiles} players={players} />
      <CombatShotEffects tiles={tiles} />
      <UnitMarkers units={visibleUnits} tiles={tiles} cities={cities} />
      <GarrisonBadges cities={cities} units={visibleUnits} tiles={tiles} />
      <UnitHpBars units={visibleUnits} tiles={tiles} cities={cities} />
      <MovementProgressBars units={visibleUnits} tiles={tiles} cities={cities} />
      <HeroMarkers heroes={visibleHeroes} tiles={tiles} />
      <CommanderMarkers commanders={visibleCommanders} tiles={tiles} />
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
      {uiMode === 'move' && selectedHex && !assigningTacticalForStack && (
        <MoveRangeOverlay fromQ={selectedHex.q} fromR={selectedHex.r} tiles={tiles} naval={moveRangeNaval} />
      )}
      {/* Tactical: valid destination hexes when assigning move/intercept for a stack */}
      {assigningTacticalForStack && (() => {
        const [tq, tr] = parseTileKey(assigningTacticalForStack);
        return <MoveRangeOverlay fromQ={tq} fromR={tr} tiles={tiles} color="#e4b44c" />;
      })()}
      {assigningTacticalForSelectedStacks?.orderType === 'move' && (
        <MultiStackMoveRangeOverlay
          stackKeys={assigningTacticalForSelectedStacks.stackKeys}
          tiles={tiles}
          color="#5ddf8c"
        />
      )}
      {assigningTacticalForSelectedStacks?.orderType === 'intercept' && (
        <MultiStackMoveRangeOverlay
          stackKeys={assigningTacticalForSelectedStacks.stackKeys}
          tiles={tiles}
          color="#e4b44c"
        />
      )}
      {tacticalIncorporateHintTiles.length > 0 && (
        <TacticalOrderTilesOverlay tiles={tacticalIncorporateHintTiles} color="#66ff99" opacity={0.22} />
      )}
      {tacticalPendingIncorporateTiles.length > 0 && (
        <TacticalOrderTilesOverlay tiles={tacticalPendingIncorporateTiles} color="#118844" opacity={0.4} />
      )}
      {tacticalAttackHintTiles.length > 0 && (
        <TacticalOrderTilesOverlay tiles={tacticalAttackHintTiles} color="#ff8888" opacity={0.22} />
      )}
      {tacticalPendingAttackTiles.length > 0 && (
        <TacticalOrderTilesOverlay tiles={tacticalPendingAttackTiles} color="#cc2222" opacity={0.42} />
      )}
      {tacticalDefendHintTiles.length > 0 && (
        <TacticalOrderTilesOverlay tiles={tacticalDefendHintTiles} color="#88aaff" opacity={0.22} />
      )}
      {tacticalPendingDefendTiles.length > 0 && (
        <TacticalOrderTilesOverlay tiles={tacticalPendingDefendTiles} color="#4466cc" opacity={0.4} />
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
      {uiMode === 'build_logging_hut' && (
        <DepositHighlightOverlay tiles={tiles} cities={cities} constructions={constructions} depositType="logging_hut" />
      )}
      {/* Road path preview (builder build mode) */}
      {uiMode === 'build_road' && roadPathSelection.length > 0 && (
        <RoadPathOverlay path={roadPathSelection} tiles={tiles} />
      )}

      {/* Supply view: logistics connection lines (green = food surplus, red = deficit) */}
      {supplyViewTab === 'supply' && supplyClustersWithHealth.length > 0 && (
        <SupplyConnectionOverlay clustersWithHealth={supplyClustersWithHealth} tiles={tiles} />
      )}

      {/* Selection + defense tower weapon range (selected hex) */}
      {selectedDefenseInstallation && (
        <SelectedDefenseTowerRangeOverlay installation={selectedDefenseInstallation} tiles={tiles} />
      )}
      {selectedHex && <SelectionRing q={selectedHex.q} r={selectedHex.r} tiles={tiles} />}
    </group>
  );
}
