import {
  Commander,
  Politician,
  PoliticianTraitId,
  POLITICIAN_TRAIT_INFO,
  CouncilPostId,
  COUNCIL_POST_IDS,
  CouncilAppointment,
  NationalCouncil,
  COMMANDER_TRAIT_INFO,
  CommanderTraitId,
  CityBuilding,
  UniversitySpecialization,
  UNIVERSITY_GRADUATE_CHANCE_BASE,
  generateId,
} from '@/types/game';

// ─── Council Boost Calculations ────────────────────────────────────

export interface CouncilBoosts {
  goldMult: number;
  productionMult: number;
  researchMult: number;
  attackMult: number;
  defenseMult: number;
}

const POST_AMPLIFIERS: Record<CouncilPostId, keyof CouncilBoosts> = {
  chancellor: 'productionMult',
  treasurer: 'goldMult',
  marshal: 'attackMult',
  spymaster: 'researchMult',
};

const POST_AMPLIFIER_BONUS = 0.5;

export function computeCouncilBoosts(
  council: NationalCouncil | undefined,
  commanders: Commander[],
  politicians: Politician[],
): CouncilBoosts {
  const boosts: CouncilBoosts = {
    goldMult: 1,
    productionMult: 1,
    researchMult: 1,
    attackMult: 1,
    defenseMult: 1,
  };

  if (!council) return boosts;

  for (const appt of council.appointments) {
    const amplifiedKey = POST_AMPLIFIERS[appt.postId];
    const amplify = 1 + POST_AMPLIFIER_BONUS;

    if (appt.assigneeKind === 'politician') {
      const pol = politicians.find(p => p.id === appt.assigneeId);
      if (!pol) continue;
      for (const tid of pol.traitIds) {
        const info = POLITICIAN_TRAIT_INFO[tid];
        if (!info) continue;
        const goldAdd = info.goldBonus * (amplifiedKey === 'goldMult' ? amplify : 1);
        const prodAdd = info.productionBonus * (amplifiedKey === 'productionMult' ? amplify : 1);
        const resAdd = info.researchBonus * (amplifiedKey === 'researchMult' ? amplify : 1);
        boosts.goldMult += goldAdd;
        boosts.productionMult += prodAdd;
        boosts.researchMult += resAdd;
      }
    } else {
      const cmd = commanders.find(c => c.id === appt.assigneeId);
      if (!cmd) continue;
      for (const tid of cmd.traitIds) {
        const info = COMMANDER_TRAIT_INFO[tid as CommanderTraitId];
        if (!info) continue;
        const atkAdd = info.attackBonus * (amplifiedKey === 'attackMult' ? amplify : 1);
        const defAdd = info.defenseBonus * (amplifiedKey === 'defenseMult' ? amplify : 1);
        boosts.attackMult += atkAdd;
        boosts.defenseMult += defAdd;
      }
    }
  }

  return boosts;
}

/** Validate and clean up council appointments (remove references to dead/missing people). */
export function cleanCouncilAppointments(
  council: NationalCouncil,
  commanders: Commander[],
  politicians: Politician[],
  ownerId: string,
): NationalCouncil {
  const validAppointments = council.appointments.filter(a => {
    if (a.assigneeKind === 'politician') {
      return politicians.some(p => p.id === a.assigneeId && p.ownerId === ownerId);
    }
    return commanders.some(c => c.id === a.assigneeId && c.ownerId === ownerId);
  });
  const seen = new Set<CouncilPostId>();
  const deduped = validAppointments.filter(a => {
    if (seen.has(a.postId)) return false;
    seen.add(a.postId);
    return true;
  });
  return { appointments: deduped };
}

// ─── Politician Generation from Universities ───────────────────────

const POL_FIRST = [
  'Alistair', 'Beatrice', 'Cedric', 'Diana', 'Edmund', 'Fiona', 'Gregory', 'Helena',
  'Irving', 'Judith', 'Kenneth', 'Lavinia', 'Marcus', 'Natasha', 'Oliver', 'Priscilla',
];
const POL_LAST = [
  'Ashbury', 'Bellingham', 'Cromwell', 'Dunmore', 'Everhart', 'Fairchild', 'Greystone', 'Halworth',
  'Ingham', 'Kensington', 'Langford', 'Montague', 'Norwood', 'Pemberton', 'Queensbury', 'Rothwell',
];

const POL_TRAIT_POOL: PoliticianTraitId[] = [
  'economist', 'merchant', 'diplomat', 'administrator', 'scholar', 'industrialist',
];

function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rollPoliticianIdentity(seed: number): {
  name: string;
  traitIds: PoliticianTraitId[];
  portraitSeed: number;
} {
  const rnd = mulberry32(seed);
  const first = POL_FIRST[Math.floor(rnd() * POL_FIRST.length)];
  const last = POL_LAST[Math.floor(rnd() * POL_LAST.length)];
  const name = `${first} ${last}`;

  const picks = new Set<PoliticianTraitId>();
  while (picks.size < 2) {
    picks.add(POL_TRAIT_POOL[Math.floor(rnd() * POL_TRAIT_POOL.length)]);
  }
  const traitIds = [...picks];
  const portraitSeed = (Math.floor(rnd() * 1e9) ^ seed) >>> 0;

  return { name, traitIds, portraitSeed };
}

export function createPoliticianRecord(
  ownerId: string,
  identity: { name: string; traitIds: PoliticianTraitId[]; portraitSeed: number },
): Politician {
  return {
    id: generateId('pol'),
    ownerId,
    name: identity.name,
    traitIds: identity.traitIds,
    portraitSeed: identity.portraitSeed,
  };
}

export interface UniversityGraduateResult {
  kind: 'commander' | 'politician' | 'none';
  seed: number;
}

/**
 * Roll whether a university produces a graduate this cycle.
 * Returns the type of graduate or 'none'.
 */
export function rollUniversityGraduate(
  building: CityBuilding,
  cycleSeed: number,
): UniversityGraduateResult {
  if (building.type !== 'university') return { kind: 'none', seed: cycleSeed };
  const level = building.level ?? 1;
  const spec = building.universitySpecialization ?? 'general';
  const chance = UNIVERSITY_GRADUATE_CHANCE_BASE * level;

  const rnd = mulberry32(cycleSeed);
  if (rnd() > chance) return { kind: 'none', seed: cycleSeed };

  const kindRoll = rnd();
  let kind: 'commander' | 'politician';

  switch (spec) {
    case 'military':
      kind = kindRoll < 0.75 ? 'commander' : 'politician';
      break;
    case 'economics':
      kind = kindRoll < 0.25 ? 'commander' : 'politician';
      break;
    case 'research':
      kind = kindRoll < 0.5 ? 'commander' : 'politician';
      break;
    default:
      kind = kindRoll < 0.5 ? 'commander' : 'politician';
      break;
  }

  const gradSeed = Math.floor(rnd() * 1e9);
  return { kind, seed: gradSeed };
}

/** Check if a person (commander or politician) is already assigned to any council post. */
export function isAssignedToCouncil(council: NationalCouncil | undefined, personId: string): boolean {
  if (!council) return false;
  return council.appointments.some(a => a.assigneeId === personId);
}

/** Get the council appointment for a given post. */
export function getCouncilAppointment(
  council: NationalCouncil | undefined,
  postId: CouncilPostId,
): CouncilAppointment | undefined {
  if (!council) return undefined;
  return council.appointments.find(a => a.postId === postId);
}

/** Assign a person to a council post, replacing any existing appointment at that post. */
export function assignToCouncilPost(
  council: NationalCouncil,
  postId: CouncilPostId,
  assigneeId: string,
  assigneeKind: 'commander' | 'politician',
): NationalCouncil {
  const filtered = council.appointments.filter(
    a => a.postId !== postId && a.assigneeId !== assigneeId,
  );
  filtered.push({ postId, assigneeId, assigneeKind });
  return { appointments: filtered };
}

/** Remove a person from the council entirely. */
export function removeFromCouncil(council: NationalCouncil, assigneeId: string): NationalCouncil {
  return { appointments: council.appointments.filter(a => a.assigneeId !== assigneeId) };
}
