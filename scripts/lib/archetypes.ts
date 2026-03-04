/**
 * Fixed archetype adversaries for robust league training.
 * These are never mutated; they are always included in the evaluation pool
 * when LEAGUE_INCLUDE_ARCHETYPES=1. IDs are stable for scheduling.
 */

import { DEFAULT_AI_PARAMS, type AiParams } from '../../src/lib/ai';

export const ARCH_BERSERKER_ID = 'arch_berserker';
export const ARCH_TURTLE_ID = 'arch_turtle';
export const ARCH_EXPANSION_ID = 'arch_expansion';
export const ARCH_SIEGE_ATTRITION_ID = 'arch_siege_attrition';

/** Ultra aggressive rush: high recruit, low siege, low farm bias. */
export const ARCH_BERSERKER: AiParams = {
  ...DEFAULT_AI_PARAMS,
  siegeChance: 0.08,
  recruitGoldThreshold: 200,
  maxRecruitsWhenRich: 4,
  maxRecruitsWhenPoor: 3,
  targetDefenderWeight: 2,
  nearestTargetDistanceRatio: 0.95,
  builderRecruitChance: 0.08,
  foodBufferThreshold: 8,
  sustainableMilitaryMultiplier: 1.1,
  farmFirstBias: 0,
  farmPriorityThreshold: 5,
  factoryUpgradePriority: 0.3,
  scoutChance: 0.6,
  incorporateVillageChance: 0.4,
  targetPopWeight: 0.7,
};

/** Defensive econ: high farm bias, high food buffer, lower recruit. */
export const ARCH_TURTLE: AiParams = {
  ...DEFAULT_AI_PARAMS,
  siegeChance: 0.15,
  recruitGoldThreshold: 550,
  maxRecruitsWhenRich: 2,
  maxRecruitsWhenPoor: 1,
  targetDefenderWeight: 4,
  nearestTargetDistanceRatio: 0.7,
  builderRecruitChance: 0.35,
  foodBufferThreshold: 22,
  sustainableMilitaryMultiplier: 0.75,
  farmFirstBias: 0.85,
  farmPriorityThreshold: 20,
  factoryUpgradePriority: 0.7,
  scoutChance: 0.5,
  incorporateVillageChance: 0.7,
  targetPopWeight: 1.2,
};

/** Village/city growth first: high incorporate, high builder, medium recruit. */
export const ARCH_EXPANSION: AiParams = {
  ...DEFAULT_AI_PARAMS,
  siegeChance: 0.12,
  recruitGoldThreshold: 380,
  maxRecruitsWhenRich: 2,
  maxRecruitsWhenPoor: 2,
  targetDefenderWeight: 3,
  nearestTargetDistanceRatio: 0.8,
  builderRecruitChance: 0.4,
  foodBufferThreshold: 16,
  sustainableMilitaryMultiplier: 0.9,
  farmFirstBias: 0.5,
  farmPriorityThreshold: 18,
  factoryUpgradePriority: 0.65,
  scoutChance: 1,
  incorporateVillageChance: 1,
  targetPopWeight: 1.3,
};

/** Slow siege pressure: high siege chance, defensive weight. */
export const ARCH_SIEGE_ATTRITION: AiParams = {
  ...DEFAULT_AI_PARAMS,
  siegeChance: 0.45,
  recruitGoldThreshold: 450,
  maxRecruitsWhenRich: 2,
  maxRecruitsWhenPoor: 1,
  targetDefenderWeight: 5,
  nearestTargetDistanceRatio: 0.65,
  builderRecruitChance: 0.2,
  foodBufferThreshold: 18,
  sustainableMilitaryMultiplier: 0.85,
  farmFirstBias: 0.3,
  farmPriorityThreshold: 14,
  factoryUpgradePriority: 0.5,
  scoutChance: 0.7,
  incorporateVillageChance: 0.6,
  targetPopWeight: 1,
};

export type ArchetypeId =
  | typeof ARCH_BERSERKER_ID
  | typeof ARCH_TURTLE_ID
  | typeof ARCH_EXPANSION_ID
  | typeof ARCH_SIEGE_ATTRITION_ID;

export const FIXED_ARCHETYPES: { id: ArchetypeId; params: AiParams }[] = [
  { id: ARCH_BERSERKER_ID, params: ARCH_BERSERKER },
  { id: ARCH_TURTLE_ID, params: ARCH_TURTLE },
  { id: ARCH_EXPANSION_ID, params: ARCH_EXPANSION },
  { id: ARCH_SIEGE_ATTRITION_ID, params: ARCH_SIEGE_ATTRITION },
];
