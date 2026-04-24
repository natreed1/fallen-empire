/**
 * AI composition scoring, tier selection, and formation destinations for {@link planAiTurn}.
 */

import {
  type Unit,
  type UnitType,
  type ArmyStance,
  type RangedVariant,
  UNIT_COSTS,
  UNIT_L2_COSTS,
  UNIT_L3_COSTS,
  hexDistance,
  tileKey,
  getHexRing,
} from '@/types/game';
import type { AiParams, MilitaryLevelMix } from '@/lib/ai';

/** Same math as aiParamsSchema.normalizeMilitaryLevelMix (avoid ai ↔ aiParamsSchema cycle). */
export function normalizeLevelMix(m: MilitaryLevelMix): MilitaryLevelMix {
  let L1 = Math.max(0, Math.min(1, m.L1));
  let L2 = Math.max(0, Math.min(1, m.L2));
  let L3 = Math.max(0, Math.min(1, m.L3));
  const sum = L1 + L2 + L3;
  if (sum <= 0) return { L1: 1 / 3, L2: 1 / 3, L3: 1 / 3 };
  return { L1: L1 / sum, L2: L2 / sum, L3: L3 / sum };
}

export type LandCombatRole = 'melee' | 'ranged' | 'cavalry' | 'siege' | 'other';

export function classifyLandCombatRole(type: UnitType): LandCombatRole {
  if (type === 'trebuchet' || type === 'battering_ram') return 'siege';
  if (type === 'cavalry' || type === 'horse_archer') return 'cavalry';
  if (type === 'ranged') return 'ranged';
  if (type === 'infantry' || type === 'defender' || type === 'crusader_knight') return 'melee';
  return 'other';
}

export interface ArmyComposition {
  totalCombat: number;
  ranged: number;
  melee: number;
  cavalry: number;
  siege: number;
  defender: number;
  byLevel: { L1: number; L2: number; L3: number };
  marksman: number;
  longbow: number;
}

/** Hash to stable index in [0, n) for deterministic “dispersion” without RNG spam. */
export function stableIndex(n: number, salt: string): number {
  if (n <= 0) return 0;
  let h = 0;
  for (let i = 0; i < salt.length; i++) h = (h * 31 + salt.charCodeAt(i)) | 0;
  return Math.abs(h) % n;
}

/** Apply one hypothetical recruit to composition (for multi-recruit same cycle). */
export function virtualAddRecruit(comp: ArmyComposition, type: UnitType, armsLevel: 1 | 2 | 3): ArmyComposition {
  const c: ArmyComposition = {
    ...comp,
    byLevel: { ...comp.byLevel },
  };
  const role = classifyLandCombatRole(type);
  if (role === 'other' || type === 'builder') return c;
  c.totalCombat++;
  if (role === 'siege') c.siege++;
  else if (role === 'ranged') {
    c.ranged++;
  } else if (role === 'cavalry') c.cavalry++;
  else if (type === 'defender') c.defender++;
  else c.melee++;
  if (armsLevel >= 3 || type === 'defender') c.byLevel.L3++;
  else if (armsLevel === 2) c.byLevel.L2++;
  else c.byLevel.L1++;
  return c;
}

export function computeArmyComposition(units: Unit[], ownerId: string): ArmyComposition {
  const out: ArmyComposition = {
    totalCombat: 0,
    ranged: 0,
    melee: 0,
    cavalry: 0,
    siege: 0,
    defender: 0,
    byLevel: { L1: 0, L2: 0, L3: 0 },
    marksman: 0,
    longbow: 0,
  };
  for (const u of units) {
    if (u.ownerId !== ownerId || u.hp <= 0) continue;
    const t = u.type;
    if (t === 'builder') continue;
    const role = classifyLandCombatRole(t);
    if (role === 'other') continue;
    out.totalCombat++;
    if (role === 'siege') out.siege++;
    else if (role === 'ranged') {
      out.ranged++;
      if (u.rangedVariant === 'marksman') out.marksman++;
      if (u.rangedVariant === 'longbowman') out.longbow++;
    } else if (role === 'cavalry') out.cavalry++;
    else if (t === 'defender') out.defender++;
    else out.melee++;
    const al = u.armsLevel ?? 1;
    if (al >= 3 || t === 'defender') out.byLevel.L3++;
    else if (al === 2) out.byLevel.L2++;
    else out.byLevel.L1++;
  }
  return out;
}

function share(n: number, d: number): number {
  return d <= 0 ? 0 : n / d;
}

export interface PickRecruitTypeArgs {
  comp: ArmyComposition;
  unitChoices: UnitType[];
  siegeChoices: UnitType[];
  params: AiParams;
  allowSiege: boolean;
  hasSiegeWorkshop: boolean;
  /** When true, next recruit should lean siege (composition gap). */
  preferSiege: boolean;
}

/**
 * Pick next land unit type: composition-corrected mix for line units; siege when under target siege share.
 */
export function pickRecruitUnitType(args: PickRecruitTypeArgs): { type: UnitType; useSiege: boolean } {
  const { comp, unitChoices, siegeChoices, params, allowSiege, hasSiegeWorkshop, preferSiege } = args;
  const str = Math.max(0, Math.min(1, params.compositionCorrectionStrength ?? 0.3));
  const tgtR = Math.max(0, Math.min(1, params.targetRangedShare ?? 0.25));
  const tgtSiege = Math.max(0, Math.min(1, params.targetSiegeShare ?? 0.15));

  const lineDen = Math.max(1, comp.totalCombat - comp.siege);
  const curR = share(comp.ranged, lineDen);
  const curSiege = share(comp.siege, Math.max(1, comp.totalCombat));

  let needSiege =
    allowSiege && hasSiegeWorkshop && siegeChoices.length > 0 && (preferSiege || curSiege + 1e-6 < tgtSiege);
  needSiege = needSiege && siegeChoices.length > 0;

  if (needSiege) {
    const si = stableIndex(siegeChoices.length, `siege-${comp.totalCombat}`);
    return { type: siegeChoices[si]!, useSiege: true };
  }

  if (unitChoices.length === 0) {
    return { type: 'infantry', useSiege: false };
  }

  const assaultW = Math.max(0.05, Math.min(0.95, params.assaultWingShare ?? 0.6));
  const screenW = Math.max(0.05, Math.min(0.95, params.screenWingShare ?? 0.2));
  const flankCav = Math.max(0, Math.min(1, params.flankCavalryShare ?? 0.2));
  const frontMelee = Math.max(0.05, Math.min(0.95, params.frontlineMeleeShare ?? 0.6));

  type Cat = 'infantry' | 'cavalry' | 'ranged' | 'defender';
  const cats = (
    [
      { cat: 'infantry' as Cat, types: unitChoices.filter(t => t === 'infantry') },
      { cat: 'cavalry' as Cat, types: unitChoices.filter(t => t === 'cavalry' || t === 'horse_archer') },
      { cat: 'ranged' as Cat, types: unitChoices.filter(t => t === 'ranged') },
      { cat: 'defender' as Cat, types: unitChoices.filter(t => t === 'defender') },
    ] as { cat: Cat; types: UnitType[] }[]
  ).filter(x => x.types.length > 0);

  const curCavShare = share(comp.cavalry, lineDen);

  const deficits: { cat: Cat; deficit: number; types: UnitType[] }[] = [];
  for (const { cat, types } of cats) {
    let target = 0;
    if (cat === 'ranged') target = tgtR;
    else if (cat === 'cavalry') target = flankCav * (1 - tgtR);
    else if (cat === 'infantry') target = frontMelee * (1 - tgtR) * (1 - assaultW * 0.2);
    else if (cat === 'defender') target = screenW * (1 - tgtR) * 0.35;

    let cur = 0;
    if (cat === 'ranged') cur = curR;
    else if (cat === 'cavalry') cur = curCavShare;
    else if (cat === 'infantry') cur = share(comp.melee, lineDen);
    else cur = share(comp.defender, lineDen);

    const raw = target - cur;
    deficits.push({ cat, deficit: raw * (0.35 + str * 1.5), types });
  }
  deficits.sort((a, b) => b.deficit - a.deficit);
  const best = deficits[0];
  if (!best || best.types.length === 0) {
    const fi = stableIndex(unitChoices.length, `uc-${comp.totalCombat}`);
    return { type: unitChoices[fi]!, useSiege: false };
  }
  const pickT = best.types[stableIndex(best.types.length, `pick-${best.cat}-${comp.totalCombat}`)]!;
  return { type: pickT, useSiege: false };
}

export interface TierPickContext {
  pick: UnitType;
  barracksLvl: number;
  hasGunsL2: boolean;
  goldBudget: number;
  stoneBudget: number;
  ironBudget: number;
  refinedWoodBudget: number;
  comp: ArmyComposition;
  mix: MilitaryLevelMix;
  params: AiParams;
  /** Empire-wide pools for per-unit tier bias (optional). */
  empireIronPool?: number;
  empireStonePool?: number;
}

export function pickArmsLevelForLineUnit(ctx: TierPickContext): 1 | 2 | 3 | null {
  const { pick, barracksLvl, hasGunsL2 } = ctx;
  if (pick === 'defender') return 3;
  const rwL3 = UNIT_L3_COSTS[pick].refinedWood ?? 0;
  const rwL2 = UNIT_L2_COSTS[pick].refinedWood ?? 0;
  const rwL1 = UNIT_COSTS[pick].refinedWood ?? 0;
  const canL3 =
    barracksLvl >= 3 &&
    hasGunsL2 &&
    ctx.goldBudget >= UNIT_L3_COSTS[pick].gold &&
    ctx.ironBudget >= (UNIT_L3_COSTS[pick].iron ?? 0) &&
    ctx.refinedWoodBudget >= rwL3;
  const canL2 =
    barracksLvl >= 2 && hasGunsL2 && ctx.goldBudget >= UNIT_L2_COSTS[pick].gold && ctx.stoneBudget >= (UNIT_L2_COSTS[pick].stone ?? 0) && ctx.refinedWoodBudget >= rwL2;
  const canL1 = ctx.goldBudget >= UNIT_COSTS[pick].gold && ctx.refinedWoodBudget >= rwL1;
  if (!canL1) return null;

  const mixStr = Math.max(0, Math.min(1, ctx.params.militaryLevelMixCorrectionStrength ?? 0.4));
  const tgt = ctx.mix;
  const n = Math.max(1, ctx.comp.byLevel.L1 + ctx.comp.byLevel.L2 + ctx.comp.byLevel.L3);
  const curL1 = ctx.comp.byLevel.L1 / n;
  const curL2 = ctx.comp.byLevel.L2 / n;
  const curL3 = ctx.comp.byLevel.L3 / n;
  const d1 = tgt.L1 - curL1;
  const d2 = tgt.L2 - curL2;
  const d3 = tgt.L3 - curL3;

  const ironPer = ctx.params.l3IronPerUnitTarget ?? 15;
  const stonePer = ctx.params.l2StonePerUnitTarget ?? 8;
  const mil = Math.max(1, ctx.comp.totalCombat);
  const ironPool = ctx.empireIronPool ?? ctx.ironBudget;
  const stonePool = ctx.empireStonePool ?? ctx.stoneBudget;
  const ironRes = ironPool / mil;
  const stoneRes = stonePool / mil;
  const ironBias = Math.max(-1, Math.min(1, (ironRes - ironPer) / Math.max(5, ironPer)));
  const stoneBias = Math.max(-1, Math.min(1, (stoneRes - stonePer) / Math.max(4, stonePer)));

  const w3 = d3 * mixStr + ironBias * 0.25 + (ctx.params.l3AcquisitionWeight ?? 1) * 0.15;
  const w2 = d2 * mixStr + stoneBias * 0.2;
  const w1 = d1 * mixStr;

  const candidates: { tier: 1 | 2 | 3; w: number; ok: boolean }[] = [
    { tier: 3, w: w3, ok: canL3 },
    { tier: 2, w: w2, ok: canL2 },
    { tier: 1, w: w1, ok: canL1 },
  ];
  candidates.sort((a, b) => b.w - a.w);
  for (const c of candidates) {
    if (c.ok) return c.tier;
  }
  return null;
}

export function pickRangedVariantBalanced(
  comp: ArmyComposition,
  cityDoctrine: RangedVariant | undefined,
  l2Rate: number,
): RangedVariant {
  if (cityDoctrine === 'marksman' || cityDoctrine === 'longbowman') return cityDoctrine;
  if (comp.marksman <= comp.longbow) return 'marksman';
  if (comp.longbow < comp.marksman) return 'longbowman';
  return l2Rate >= 0.5 ? 'marksman' : 'longbowman';
}

export function formationMoveForUnit(
  unit: Unit,
  enemyCity: { q: number; r: number },
  tiles: Map<string, import('@/types/game').Tile>,
  params: AiParams,
  _assaultPool: number,
  _screenPool: number,
): { toQ: number; toR: number; stance: ArmyStance } {
  const role = classifyLandCombatRole(unit.type);
  const cq = enemyCity.q;
  const cr = enemyCity.r;
  const cohesion = Math.max(0, Math.min(1, params.formationCohesion ?? 0.7));
  const disp = Math.max(0, Math.min(1, params.targetDispersion ?? 0.5));

  const back = Math.max(1, Math.min(6, Math.round(params.backlineRangedDistance ?? 3)));
  const siegeD = Math.max(back, Math.min(8, Math.round(params.siegeBacklineDistance ?? 4)));

  let dist = 1;
  if (role === 'ranged') dist = back;
  else if (role === 'siege') dist = siegeD;
  else if (role === 'cavalry') dist = 2;
  else dist = 1;

  const ring = getHexRing(cq, cr, dist);
  const land = ring.filter(({ q, r }) => {
    const t = tiles.get(tileKey(q, r));
    return t && t.biome !== 'water' && t.biome !== 'mountain';
  });
  if (land.length === 0) {
    return { toQ: cq, toR: cr, stance: role === 'ranged' ? 'skirmish' : 'aggressive' };
  }

  const scored = land.map(h => ({
    h,
    d: hexDistance(unit.q, unit.r, h.q, h.r),
  }));
  scored.sort((a, b) => a.d - b.d);
  const idx = stableIndex(scored.length, `${unit.id}-form-${cohesion}-${disp}`);
  const pick = scored[Math.min(idx, scored.length - 1)]!.h;

  let stance: ArmyStance = 'aggressive';
  if (role === 'ranged') stance = 'skirmish';
  else if (role === 'siege') stance = 'defensive';

  return { toQ: pick.q, toR: pick.r, stance };
}
