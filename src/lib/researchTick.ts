import {
  Player,
  City,
  Commander,
  Politician,
  TechId,
  TECH_TREE,
  STARTING_TECHS,
  EDUCATION_BASE_LITERACY_PER_CYCLE,
  EDUCATION_LEVEL_LITERACY_MULT,
  UNIVERSITY_EDUCATION_PER_LEVEL,
  EducationState,
  NationalCouncil,
} from '@/types/game';
import { computeCouncilBoosts } from './nationalCouncil';

/** Compute total literacy gain per cycle for a player. */
export function computeLiteracyPerCycle(
  player: Player,
  cities: City[],
  council: NationalCouncil | undefined,
  commanders: Commander[],
  politicians: Politician[],
): number {
  const education = player.education ?? { level: 1, literacy: 0 };
  const baseLiteracy = EDUCATION_BASE_LITERACY_PER_CYCLE;
  const levelBonus = education.level * EDUCATION_LEVEL_LITERACY_MULT;

  let universityBonus = 0;
  const playerCities = cities.filter(c => c.ownerId === player.id);
  for (const city of playerCities) {
    for (const b of city.buildings) {
      if (b.type !== 'university') continue;
      const level = b.level ?? 1;
      universityBonus += UNIVERSITY_EDUCATION_PER_LEVEL * level;
    }
  }

  const councilBoosts = computeCouncilBoosts(council, commanders, politicians);
  const raw = (baseLiteracy + levelBonus + universityBonus) * councilBoosts.researchMult;

  return Math.max(0, raw);
}

/** Compute research points generated per cycle toward the active tech. */
export function computeResearchPerCycle(
  player: Player,
  cities: City[],
  council: NationalCouncil | undefined,
  commanders: Commander[],
  politicians: Politician[],
): number {
  const education = player.education ?? { level: 1, literacy: 0 };
  const literacy = education.literacy;
  const literacyFactor = 0.5 + (literacy / 100) * 1.5;

  let universityResearch = 0;
  const playerCities = cities.filter(c => c.ownerId === player.id);
  for (const city of playerCities) {
    for (const b of city.buildings) {
      if (b.type !== 'university') continue;
      const level = b.level ?? 1;
      const spec = b.universitySpecialization ?? 'general';
      let researchBase = level * 0.8;
      if (spec === 'research') researchBase *= 1.5;
      universityResearch += researchBase;
    }
  }

  const councilBoosts = computeCouncilBoosts(council, commanders, politicians);
  const raw = (literacyFactor + universityResearch) * councilBoosts.researchMult;

  return Math.max(0, raw);
}

export interface ResearchTickResult {
  player: Player;
  completedTech: TechId | null;
}

/**
 * Process one economy cycle of education + research for a player.
 * Mutates the player in-place and returns any newly completed tech.
 */
export function processResearchTick(
  player: Player,
  cities: City[],
  commanders: Commander[],
  politicians: Politician[],
): ResearchTickResult {
  if (!player.education) {
    player.education = { level: 1, literacy: 0 };
  }
  if (!player.researchedTechs) {
    player.researchedTechs = [...STARTING_TECHS];
  }

  const council = player.nationalCouncil;
  const literacyGain = computeLiteracyPerCycle(player, cities, council, commanders, politicians);
  player.education.literacy = Math.min(100, player.education.literacy + literacyGain);

  let completedTech: TechId | null = null;

  if (player.activeResearch) {
    const techDef = TECH_TREE[player.activeResearch];
    if (techDef) {
      const researchGain = computeResearchPerCycle(player, cities, council, commanders, politicians);
      player.researchProgress = (player.researchProgress ?? 0) + researchGain;

      if (player.researchProgress >= techDef.researchCost) {
        player.researchedTechs.push(player.activeResearch);
        completedTech = player.activeResearch;
        player.activeResearch = null;
        player.researchProgress = 0;
      }
    }
  }

  return { player, completedTech };
}

/** Get techs available for research (prerequisites met, not already researched). */
export function getAvailableTechs(player: Player): TechId[] {
  const researched = new Set(player.researchedTechs ?? STARTING_TECHS);
  const available: TechId[] = [];

  for (const [id, def] of Object.entries(TECH_TREE)) {
    const techId = id as TechId;
    if (researched.has(techId)) continue;
    if (def.researchCost === 0) continue;
    const prereqsMet = def.prerequisites.every(p => researched.has(p));
    if (prereqsMet) available.push(techId);
  }

  return available;
}

/** Check if player can start researching a given tech. */
export function canResearchTech(player: Player, techId: TechId): boolean {
  const researched = new Set(player.researchedTechs ?? STARTING_TECHS);
  if (researched.has(techId)) return false;
  const def = TECH_TREE[techId];
  if (!def) return false;
  return def.prerequisites.every(p => researched.has(p));
}
