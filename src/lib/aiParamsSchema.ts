/**
 * Single source of truth for AI param keys, mutation ranges, and consistency checks.
 * Ensures AiParams, DEFAULT_AI_PARAMS, and all evolution/mutation paths stay in sync.
 */

import type { AiParams, MilitaryLevelMix } from './ai';
import { DEFAULT_AI_PARAMS } from './ai';

/** All evolvable param keys (scalar + structured). Must match AiParams exactly. */
export const EVOLVABLE_PARAM_KEYS = [
  'siegeChance',
  'recruitGoldThreshold',
  'maxRecruitsWhenRich',
  'maxRecruitsWhenPoor',
  'targetDefenderWeight',
  'nearestTargetDistanceRatio',
  'builderRecruitChance',
  'builderRecruitForMinesAndSiege',
  'foodBufferThreshold',
  'sustainableMilitaryMultiplier',
  'farmFirstBias',
  'farmPriorityThreshold',
  'factoryUpgradePriority',
  'scoutChance',
  'incorporateVillageChance',
  'targetPopWeight',
  'minePriorityThreshold',
  'l2AdoptionRate',
  'targetRangedShare',
  'targetSiegeShare',
  'compositionCorrectionStrength',
  'assaultWingShare',
  'screenWingShare',
  'maxChaseDistance',
  'targetDispersion',
  'villageDefensePriority',
  'villageRecapturePriority',
  'frontlineMeleeShare',
  'backlineRangedDistance',
  'siegeBacklineDistance',
  'flankCavalryShare',
  'formationCohesion',
  'l3AcquisitionWeight',
  'l3IronPerUnitTarget',
  'l2StonePerUnitTarget',
  'militaryLevelMixTarget',
  'militaryLevelMixCorrectionStrength',
  'defenderCityHexCoverageTarget',
  'defenderAssignmentPriority',
  'wallBuildPerCityTarget',
  'wallBuildPriority',
  'wallToDefenderSynergyWeight',
  'wallClosurePriority',
  'wallRepairPriority',
  'wallRingTarget',
  'wallClosureUptimeWeight',
  'supplyExpansionPriority',
  'supplyAnchorDistanceWeight',
  'supplyStarvationRiskWeight',
  'supplyCityAcquisitionBias',
  'contestedZoneCommitShare',
  'contestedZoneMinSurplusMilitary',
  'commanderFieldAssignRate',
  'commanderMinArmySize',
  'scrollTerrainPriority',
  'scrollTerrainMaxDivert',
  'universityIronMinePref',
  'universityCityDefenseThreshold',
] as const;

export type EvolvableParamKey = (typeof EVOLVABLE_PARAM_KEYS)[number];

/** Scalar keys only (for trend report / numeric iteration). Excludes structured params. */
export const SCALAR_PARAM_KEYS = EVOLVABLE_PARAM_KEYS.filter(
  (k): k is Exclude<EvolvableParamKey, 'militaryLevelMixTarget'> => k !== 'militaryLevelMixTarget',
);

export type ExplorationLevel = 'low' | 'medium' | 'high';

export interface MutationRange {
  min: number;
  max: number;
  round?: boolean;
  exploration?: ExplorationLevel;
}

/** Mutation ranges and exploration for each scalar param. All mutated params must have an entry. */
export const MUTATION_RANGES: Record<Exclude<EvolvableParamKey, 'militaryLevelMixTarget'>, MutationRange> = {
  siegeChance: { min: 0.05, max: 0.5, exploration: 'medium' },
  recruitGoldThreshold: { min: 100, max: 800, round: true, exploration: 'medium' },
  maxRecruitsWhenRich: { min: 1, max: 5, round: true, exploration: 'low' },
  maxRecruitsWhenPoor: { min: 1, max: 5, round: true, exploration: 'low' },
  targetDefenderWeight: { min: 1, max: 8, exploration: 'medium' },
  nearestTargetDistanceRatio: { min: 0.5, max: 1, exploration: 'low' },
  builderRecruitChance: { min: 0.05, max: 0.5, exploration: 'medium' },
  builderRecruitForMinesAndSiege: { min: 0, max: 1, exploration: 'medium' },
  foodBufferThreshold: { min: 0, max: 30, round: true, exploration: 'medium' },
  sustainableMilitaryMultiplier: { min: 0.6, max: 1.2, exploration: 'low' },
  farmFirstBias: { min: 0, max: 1, exploration: 'medium' },
  farmPriorityThreshold: { min: 0, max: 30, round: true, exploration: 'medium' },
  factoryUpgradePriority: { min: 0, max: 1, exploration: 'low' },
  scoutChance: { min: 0, max: 1, exploration: 'low' },
  incorporateVillageChance: { min: 0, max: 1, exploration: 'low' },
  targetPopWeight: { min: 0.5, max: 2, exploration: 'medium' },
  minePriorityThreshold: { min: 0, max: 30, round: true, exploration: 'medium' },
  l2AdoptionRate: { min: 0, max: 1, exploration: 'medium' },
  targetRangedShare: { min: 0, max: 1, exploration: 'medium' },
  targetSiegeShare: { min: 0, max: 1, exploration: 'medium' },
  compositionCorrectionStrength: { min: 0, max: 1, exploration: 'medium' },
  assaultWingShare: { min: 0, max: 1, exploration: 'medium' },
  screenWingShare: { min: 0, max: 1, exploration: 'medium' },
  maxChaseDistance: { min: 2, max: 15, round: true, exploration: 'medium' },
  targetDispersion: { min: 0, max: 1, exploration: 'medium' },
  villageDefensePriority: { min: 0, max: 1, exploration: 'medium' },
  villageRecapturePriority: { min: 0, max: 1, exploration: 'medium' },
  frontlineMeleeShare: { min: 0, max: 1, exploration: 'medium' },
  backlineRangedDistance: { min: 1, max: 6, round: true, exploration: 'low' },
  siegeBacklineDistance: { min: 2, max: 8, round: true, exploration: 'low' },
  flankCavalryShare: { min: 0, max: 1, exploration: 'medium' },
  formationCohesion: { min: 0, max: 1, exploration: 'low' },
  l3AcquisitionWeight: { min: 0, max: 2, exploration: 'medium' },
  l3IronPerUnitTarget: { min: 5, max: 30, round: true, exploration: 'medium' },
  l2StonePerUnitTarget: { min: 2, max: 20, round: true, exploration: 'medium' },
  militaryLevelMixCorrectionStrength: { min: 0, max: 1, exploration: 'medium' },
  defenderCityHexCoverageTarget: { min: 0, max: 1, exploration: 'medium' },
  defenderAssignmentPriority: { min: 0, max: 1, exploration: 'medium' },
  wallBuildPerCityTarget: { min: 0, max: 6, round: true, exploration: 'medium' },
  wallBuildPriority: { min: 0, max: 1, exploration: 'medium' },
  wallToDefenderSynergyWeight: { min: 0, max: 1, exploration: 'low' },
  wallClosurePriority: { min: 0, max: 1, exploration: 'medium' },
  wallRepairPriority: { min: 0, max: 1, exploration: 'medium' },
  wallRingTarget: { min: 1, max: 2, round: true, exploration: 'low' },
  wallClosureUptimeWeight: { min: 0, max: 1, exploration: 'medium' },
  supplyExpansionPriority: { min: 0, max: 1, exploration: 'medium' },
  supplyAnchorDistanceWeight: { min: 0, max: 2, exploration: 'medium' },
  supplyStarvationRiskWeight: { min: 0, max: 2, exploration: 'medium' },
  supplyCityAcquisitionBias: { min: 0, max: 1, exploration: 'medium' },
  contestedZoneCommitShare: { min: 0, max: 0.5, exploration: 'medium' },
  contestedZoneMinSurplusMilitary: { min: 0, max: 15, round: true, exploration: 'medium' },
  commanderFieldAssignRate: { min: 0, max: 1, exploration: 'medium' },
  commanderMinArmySize: { min: 1, max: 8, round: true, exploration: 'low' },
  scrollTerrainPriority: { min: 0, max: 1, exploration: 'medium' },
  scrollTerrainMaxDivert: { min: 0, max: 5, round: true, exploration: 'medium' },
  universityIronMinePref: { min: 0, max: 1, exploration: 'medium' },
  universityCityDefenseThreshold: { min: 0, max: 1, exploration: 'medium' },
};

/**
 * Params not yet consumed by planAiTurn (or fixed by design); excluded so train-ai does not waste mutation budget.
 * Wired params (l3AcquisitionWeight, l2AdoptionRate, etc.) stay in the mutable set.
 */
export const MUTATION_EXCLUDED_KEYS: EvolvableParamKey[] = [
  'builderRecruitChance',
  'builderRecruitForMinesAndSiege',
  'minePriorityThreshold',
  'targetRangedShare',
  'targetSiegeShare',
  'compositionCorrectionStrength',
  'militaryLevelMixTarget',
  'militaryLevelMixCorrectionStrength',
  'l3IronPerUnitTarget',
  'l2StonePerUnitTarget',
  'assaultWingShare',
  'screenWingShare',
  'maxChaseDistance',
  'targetDispersion',
  'villageDefensePriority',
  'villageRecapturePriority',
  'frontlineMeleeShare',
  'backlineRangedDistance',
  'siegeBacklineDistance',
  'flankCavalryShare',
  'formationCohesion',
  'defenderCityHexCoverageTarget',
  'defenderAssignmentPriority',
  'wallBuildPerCityTarget',
  'wallToDefenderSynergyWeight',
  'wallClosureUptimeWeight',
];

/** Normalize L1+L2+L3 to sum to 1; clamp each to [0,1]. */
export function normalizeMilitaryLevelMix(m: MilitaryLevelMix): MilitaryLevelMix {
  let L1 = Math.max(0, Math.min(1, m.L1));
  let L2 = Math.max(0, Math.min(1, m.L2));
  let L3 = Math.max(0, Math.min(1, m.L3));
  const sum = L1 + L2 + L3;
  if (sum <= 0) return { L1: 1 / 3, L2: 1 / 3, L3: 1 / 3 };
  return { L1: L1 / sum, L2: L2 / sum, L3: L3 / sum };
}

/**
 * Fail fast if DEFAULT_AI_PARAMS keys do not exactly match EVOLVABLE_PARAM_KEYS.
 * Call at startup of any trainer/evolution script.
 */
export function assertAiParamsConsistency(): void {
  const defaultKeys = new Set(Object.keys(DEFAULT_AI_PARAMS) as EvolvableParamKey[]);
  const expectedKeys = new Set(EVOLVABLE_PARAM_KEYS);
  const missing = EVOLVABLE_PARAM_KEYS.filter(k => !defaultKeys.has(k));
  const orphan = [...defaultKeys].filter(k => !expectedKeys.has(k));
  if (missing.length > 0 || orphan.length > 0) {
    throw new Error(
      `AiParams consistency check failed. DEFAULT_AI_PARAMS must exactly match EVOLVABLE_PARAM_KEYS. ` +
        `Missing in defaults: ${missing.join(', ') || 'none'}. ` +
        `Orphan in defaults: ${orphan.join(', ') || 'none'}.`,
    );
  }
}

export interface MutationSpaceSummary {
  totalParamCount: number;
  paramsInMutationSpace: string[];
  excludedFromMutation: string[];
  excludedReason: string;
}

/**
 * Return a summary for debug print at run start: total count, list in mutation space, excluded with reason.
 */
export function getMutationSpaceSummary(): MutationSpaceSummary {
  const inSpace = EVOLVABLE_PARAM_KEYS.filter(k => !MUTATION_EXCLUDED_KEYS.includes(k));
  return {
    totalParamCount: EVOLVABLE_PARAM_KEYS.length,
    paramsInMutationSpace: [...inSpace],
    excludedFromMutation: [...MUTATION_EXCLUDED_KEYS],
    excludedReason: MUTATION_EXCLUDED_KEYS.length === 0 ? 'none' : 'intentionally fixed (allowlisted)',
  };
}

/** Per-param override from trend report: custom bounds and mutation strength multiplier. */
export interface TrendParamOverride {
  min: number;
  max: number;
  strengthMultiplier: number;
}

/** Overrides keyed by param name. When present, use these bounds and scale strength. */
export type TrendMutationOverrides = Partial<Record<Exclude<EvolvableParamKey, 'militaryLevelMixTarget'>, TrendParamOverride>>;

function mutateScalar(
  parent: AiParams,
  key: Exclude<EvolvableParamKey, 'militaryLevelMixTarget'>,
  strength: number,
  override?: TrendParamOverride,
): number {
  const range = MUTATION_RANGES[key];
  const effectiveRange = override
    ? { min: Math.min(override.min, override.max), max: Math.max(override.min, override.max), round: range.round }
    : range;
  const effectiveStrength = override ? strength * override.strengthMultiplier : strength;
  const v = (parent as unknown as Record<string, number>)[key] ?? 0;
  const delta = (Math.random() - 0.5) * 2 * effectiveStrength * (effectiveRange.max - effectiveRange.min) * 0.5;
  let out = Math.max(effectiveRange.min, Math.min(effectiveRange.max, v + delta));
  if (range.round) out = Math.round(out);
  return out;
}

/**
 * Mutate all evolvable params with safe min/max clamps. Structured param (militaryLevelMixTarget) is normalized.
 * If trendOverrides provided (from artifacts/trend-report.json), uses recommendedMutationRange and classification-based strength.
 */
export function mutateParams(
  parent: AiParams,
  strength: number,
  trendOverrides?: TrendMutationOverrides,
): AiParams {
  const base = { ...DEFAULT_AI_PARAMS, ...parent };
  const out: AiParams = { ...base };

  for (const key of SCALAR_PARAM_KEYS) {
    if (MUTATION_EXCLUDED_KEYS.includes(key)) continue;
    (out as unknown as Record<string, number>)[key] = mutateScalar(
      out,
      key,
      strength,
      trendOverrides?.[key],
    );
  }

  if (!MUTATION_EXCLUDED_KEYS.includes('militaryLevelMixTarget')) {
    const mix = base.militaryLevelMixTarget ?? { L1: 0.6, L2: 0.3, L3: 0.1 };
    const L1 = Math.max(0, Math.min(1, mix.L1 + (Math.random() - 0.5) * 2 * strength * 0.3));
    const L2 = Math.max(0, Math.min(1, mix.L2 + (Math.random() - 0.5) * 2 * strength * 0.3));
    const L3 = Math.max(0, Math.min(1, mix.L3 + (Math.random() - 0.5) * 2 * strength * 0.3));
    out.militaryLevelMixTarget = normalizeMilitaryLevelMix({ L1, L2, L3 });
  }

  return out;
}
