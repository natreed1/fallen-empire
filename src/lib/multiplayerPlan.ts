import type { AiActions } from './ai';
import {
  BUILDING_COSTS,
  UNIT_COSTS,
  type ArmyStance,
  type BuildingType,
  type UnitType,
} from '@/types/game';

const BUILDING_TYPES = new Set<BuildingType>(Object.keys(BUILDING_COSTS) as BuildingType[]);
const UNIT_TYPES = new Set<UnitType>(Object.keys(UNIT_COSTS) as UnitType[]);
const UPGRADE_TYPES = new Set(['barracks', 'factory', 'farm', 'banana_farm'] as const);
const UNIVERSITY_TASKS = new Set(['expand_quarries', 'expand_iron_mines', 'expand_forestry', 'city_defenses'] as const);
const ARMY_STANCES = new Set<ArmyStance>(['aggressive', 'defensive', 'passive', 'skirmish', 'hold_the_line']);
const RANGED_VARIANTS = new Set(['marksman', 'longbowman'] as const);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isCoord(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function setHas<T extends string>(set: ReadonlySet<T>, value: unknown): value is T {
  return typeof value === 'string' && set.has(value as T);
}

function sanitizeArray<T>(value: unknown, guard: (item: unknown) => item is T): T[] | undefined {
  return Array.isArray(value) ? value.filter(guard) : undefined;
}

function isBuildAction(value: unknown): value is AiActions['builds'][number] {
  return (
    isRecord(value) &&
    isString(value.cityId) &&
    setHas(BUILDING_TYPES, value.type) &&
    isCoord(value.q) &&
    isCoord(value.r)
  );
}

function isUpgradeAction(value: unknown): value is AiActions['upgrades'][number] {
  return (
    isRecord(value) &&
    isString(value.cityId) &&
    setHas(UPGRADE_TYPES, value.type) &&
    isCoord(value.buildingQ) &&
    isCoord(value.buildingR)
  );
}

function isRecruitAction(value: unknown): value is AiActions['recruits'][number] {
  return (
    isRecord(value) &&
    isString(value.cityId) &&
    setHas(UNIT_TYPES, value.type) &&
    (value.armsLevel === undefined || value.armsLevel === 1 || value.armsLevel === 2 || value.armsLevel === 3) &&
    (value.rangedVariant === undefined || setHas(RANGED_VARIANTS, value.rangedVariant))
  );
}

function isMoveAction(value: unknown): value is AiActions['moveTargets'][number] {
  return isRecord(value) && isString(value.unitId) && isCoord(value.toQ) && isCoord(value.toR);
}

function isScoutAction(value: unknown): value is AiActions['scouts'][number] {
  return isRecord(value) && isCoord(value.targetQ) && isCoord(value.targetR);
}

function isIncorporateAction(value: unknown): value is AiActions['incorporateVillages'][number] {
  return isRecord(value) && isCoord(value.q) && isCoord(value.r);
}

function isWallRingAction(value: unknown): value is AiActions['buildWallRings'][number] {
  return isRecord(value) && isString(value.cityId) && (value.ring === 1 || value.ring === 2);
}

function isCommanderAssignment(value: unknown): value is AiActions['commanderAssignments'][number] {
  if (!isRecord(value) || !isString(value.commanderId) || !isRecord(value.assignment)) return false;
  if (value.assignment.kind === 'field') return isString(value.assignment.anchorUnitId);
  if (value.assignment.kind === 'city_defense') return isString(value.assignment.cityId);
  return false;
}

function isScrollAttachment(value: unknown): value is AiActions['scrollAttachments'][number] {
  return isRecord(value) && isString(value.scrollId) && isString(value.carrierUnitId);
}

function isUniversityTask(value: unknown): value is AiActions['universityTasks'][number] {
  return isRecord(value) && isString(value.cityId) && setHas(UNIVERSITY_TASKS, value.task);
}

function isStanceChange(value: unknown): value is AiActions['stanceChanges'][number] {
  return isRecord(value) && isString(value.unitId) && setHas(ARMY_STANCES, value.stance);
}

function isRetreat(value: unknown): value is AiActions['retreats'][number] {
  return isRecord(value) && isString(value.unitId);
}

export function sanitizeMultiplayerPlanPatch(patch: unknown): Partial<AiActions> {
  if (!isRecord(patch)) return {};

  const sanitized: Partial<AiActions> = {};
  const builds = sanitizeArray(patch.builds, isBuildAction);
  const upgrades = sanitizeArray(patch.upgrades, isUpgradeAction);
  const recruits = sanitizeArray(patch.recruits, isRecruitAction);
  const moveTargets = sanitizeArray(patch.moveTargets, isMoveAction);
  const scouts = sanitizeArray(patch.scouts, isScoutAction);
  const incorporateVillages = sanitizeArray(patch.incorporateVillages, isIncorporateAction);
  const buildWallRings = sanitizeArray(patch.buildWallRings, isWallRingAction);
  const commanderAssignments = sanitizeArray(patch.commanderAssignments, isCommanderAssignment);
  const scrollAttachments = sanitizeArray(patch.scrollAttachments, isScrollAttachment);
  const universityTasks = sanitizeArray(patch.universityTasks, isUniversityTask);
  const stanceChanges = sanitizeArray(patch.stanceChanges, isStanceChange);
  const retreats = sanitizeArray(patch.retreats, isRetreat);

  if (builds) sanitized.builds = builds;
  if (upgrades) sanitized.upgrades = upgrades;
  if (recruits) sanitized.recruits = recruits;
  if (moveTargets) sanitized.moveTargets = moveTargets;
  if (scouts) sanitized.scouts = scouts;
  if (incorporateVillages) sanitized.incorporateVillages = incorporateVillages;
  if (buildWallRings) sanitized.buildWallRings = buildWallRings;
  if (commanderAssignments) sanitized.commanderAssignments = commanderAssignments;
  if (scrollAttachments) sanitized.scrollAttachments = scrollAttachments;
  if (universityTasks) sanitized.universityTasks = universityTasks;
  if (stanceChanges) sanitized.stanceChanges = stanceChanges;
  if (retreats) sanitized.retreats = retreats;

  return sanitized;
}

export function mergeMultiplayerPlan(base: AiActions, patch: unknown): AiActions {
  const sanitized = sanitizeMultiplayerPlanPatch(patch);
  const moveTargets = new Map<string, AiActions['moveTargets'][number]>();
  for (const m of base.moveTargets) moveTargets.set(m.unitId, m);
  for (const m of sanitized.moveTargets ?? []) moveTargets.set(m.unitId, m);

  return {
    ...base,
    ...sanitized,
    moveTargets: Array.from(moveTargets.values()),
  };
}
