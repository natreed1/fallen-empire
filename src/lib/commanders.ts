import {
  City,
  Commander,
  CommanderAssignment,
  CommanderTraitId,
  COMMANDER_TRAIT_INFO,
  Unit,
  generateId,
} from '@/types/game';

export function sumCommanderTraitBonuses(traitIds: CommanderTraitId[]): {
  attackBonus: number;
  defenseBonus: number;
} {
  let attackBonus = 0;
  let defenseBonus = 0;
  for (const id of traitIds) {
    const t = COMMANDER_TRAIT_INFO[id];
    if (!t) continue;
    attackBonus += t.attackBonus;
    defenseBonus += t.defenseBonus;
  }
  return { attackBonus, defenseBonus };
}

/** Commander buffs this unit's outgoing attacks (same hex rules for field; city tile for garrison). */
export function commanderAppliesToUnit(
  commander: Commander,
  unit: Unit,
  cities: City[],
  units: Unit[],
): boolean {
  if (commander.ownerId !== unit.ownerId || !commander.assignment) return false;

  const a = commander.assignment;
  if (a.kind === 'city_defense') {
    const city = cities.find(c => c.id === a.cityId);
    return !!(
      city &&
      city.ownerId === unit.ownerId &&
      unit.q === city.q &&
      unit.r === city.r
    );
  }

  const anchor = units.find(u => u.id === a.anchorUnitId);
  return !!(
    anchor &&
    anchor.hp > 0 &&
    !anchor.aboardShipId &&
    anchor.ownerId === unit.ownerId &&
    anchor.q === unit.q &&
    anchor.r === unit.r
  );
}

export function commanderAttackMultiplierForUnit(
  unit: Unit,
  commanders: Commander[],
  cities: City[],
  units: Unit[],
): number {
  let mult = 1;
  for (const c of commanders) {
    if (!commanderAppliesToUnit(c, unit, cities, units)) continue;
    const { attackBonus } = sumCommanderTraitBonuses(c.traitIds);
    mult *= 1 + attackBonus;
  }
  return mult;
}

/** Multiplier applied to damage received (lower = tougher). */
export function commanderDefenseDamageFactorForUnit(
  unit: Unit,
  commanders: Commander[],
  cities: City[],
  units: Unit[],
): number {
  let reduction = 0;
  for (const c of commanders) {
    if (!commanderAppliesToUnit(c, unit, cities, units)) continue;
    const { defenseBonus } = sumCommanderTraitBonuses(c.traitIds);
    reduction += defenseBonus;
  }
  reduction = Math.min(0.35, reduction);
  return Math.max(0.65, 1 - reduction);
}

export function syncCommandersToAssignments(
  commanders: Commander[],
  cities: City[],
  units: Unit[],
): void {
  for (const c of commanders) {
    if (!c.assignment) continue;
    const a = c.assignment;
    if (a.kind === 'city_defense') {
      const city = cities.find(ct => ct.id === a.cityId && ct.ownerId === c.ownerId);
      if (city) {
        c.q = city.q;
        c.r = city.r;
      }
      continue;
    }
    const anchor = units.find(u => u.id === a.anchorUnitId);
    if (anchor && anchor.hp > 0 && !anchor.aboardShipId) {
      c.q = anchor.q;
      c.r = anchor.r;
    }
  }
}

export function clearInvalidCommanderAssignments(commanders: Commander[], cities: City[]): void {
  for (const c of commanders) {
    const a = c.assignment;
    if (!a || a.kind !== 'city_defense') continue;
    const city = cities.find(ct => ct.id === a.cityId);
    if (!city || city.ownerId !== c.ownerId) c.assignment = null;
  }
}

export function unassignCommandersWithDeadAnchors(commanders: Commander[], units: Unit[]): void {
  for (const c of commanders) {
    const a = c.assignment;
    if (!a || a.kind !== 'field') continue;
    const anchor = units.find(u => u.id === a.anchorUnitId);
    if (!anchor || anchor.hp <= 0) c.assignment = null;
  }
}

function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = [
  'Aldric', 'Brienne', 'Cassian', 'Dara', 'Elena', 'Falk', 'Giselle', 'Hakon',
  'Isolde', 'Joric', 'Kira', 'Lucan', 'Mira', 'Nolan', 'Orla', 'Pietro',
];
const LAST = [
  'Ashford', 'Blackhelm', 'Corwyn', 'Duras', 'Elmcrest', 'Fairfax', 'Goldleaf', 'Harrow',
  'Ironwright', 'Kindmarsh', 'Lorne', 'Marrow', 'Northgate', 'Oakheart', 'Pike', 'Redmaine',
];

const ORIGIN = [
  'a border keep', 'a river march', 'coastal cliffs', 'highland sheep country',
  'an abbey scriptorium', 'a guild hall', 'winter camps on the steppe', 'a merchant caravan',
];

const MENTOR = [
  'a one-eyed veteran', 'a stern chaplain', 'a disgraced duelist', 'their elder sibling',
  'a foreign sellsword', 'a cartographer-knight', 'a siege engineer', 'a silent scout',
];

const GOAL = [
  'a name that outlives the war',
  'enough coin to retire the order',
  'a charter for their house',
  'forgiveness for an old mistake',
  'proof they belong in the line',
  'a clean border for their kin',
];

const TRAIT_POOL: CommanderTraitId[] = [
  'duelist', 'stalwart', 'tactician', 'siege_born', 'skirmisher', 'warden',
];

export function createCommanderRecord(
  ownerId: string,
  identity: { name: string; backstory: string; traitIds: CommanderTraitId[]; portraitSeed: number },
  portraitDataUrl: string | undefined,
  q: number,
  r: number,
  assignment: CommanderAssignment | null,
): Commander {
  return {
    id: generateId('cmd'),
    ownerId,
    name: identity.name,
    backstory: identity.backstory,
    traitIds: identity.traitIds,
    portraitSeed: identity.portraitSeed,
    portraitDataUrl,
    q,
    r,
    assignment,
  };
}

export function rollCommanderIdentity(seed: number): {
  name: string;
  backstory: string;
  traitIds: CommanderTraitId[];
  portraitSeed: number;
} {
  const rnd = mulberry32(seed);
  const first = FIRST[Math.floor(rnd() * FIRST.length)];
  const last = LAST[Math.floor(rnd() * LAST.length)];
  const name = `${first} ${last}`;
  const origin = ORIGIN[Math.floor(rnd() * ORIGIN.length)];
  const mentor = MENTOR[Math.floor(rnd() * MENTOR.length)];
  const goal = GOAL[Math.floor(rnd() * GOAL.length)];
  const backstory = `Raised near ${origin}, ${first} trained under ${mentor}. ${last} seeks ${goal}.`;

  const picks = new Set<CommanderTraitId>();
  while (picks.size < 2) {
    picks.add(TRAIT_POOL[Math.floor(rnd() * TRAIT_POOL.length)]);
  }
  const traitIds = [...picks];
  const portraitSeed = (Math.floor(rnd() * 1e9) ^ seed) >>> 0;

  return { name, backstory, traitIds, portraitSeed };
}
