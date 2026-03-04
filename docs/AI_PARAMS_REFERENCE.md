# AI params reference

Single source of truth for code: **`src/lib/ai.ts`** (interface + defaults) and **`src/lib/aiParamsSchema.ts`** (keys, mutation ranges, assertion). This doc is a snapshot for humans.

## Final param list (44 total)

| Param | Default | Mutation range | Exploration |
|-------|--------|----------------|--------------|
| siegeChance | 0.22 | [0.05, 0.5] | medium |
| recruitGoldThreshold | 400 | [100, 800] round | medium |
| maxRecruitsWhenRich | 3 | [1, 5] round | low |
| maxRecruitsWhenPoor | 2 | [1, 5] round | low |
| targetDefenderWeight | 3 | [1, 8] | medium |
| nearestTargetDistanceRatio | 0.85 | [0.5, 1] | low |
| builderRecruitChance | 0.2 | [0.05, 0.5] | medium |
| foodBufferThreshold | 14 | [0, 30] round | medium |
| sustainableMilitaryMultiplier | 0.9 | [0.6, 1.2] | low |
| farmFirstBias | 0 | [0, 1] | medium |
| farmPriorityThreshold | 15 | [0, 30] round | medium |
| factoryUpgradePriority | 0.6 | [0, 1] | low |
| scoutChance | 1 | [0, 1] | low |
| incorporateVillageChance | 1 | [0, 1] | low |
| targetPopWeight | 1 | [0.5, 2] | medium |
| minePriorityThreshold | 12 | [0, 30] round | medium |
| l2AdoptionRate | 0.5 | [0, 1] | medium |
| targetRangedShare | 0.25 | [0, 1] | medium |
| targetSiegeShare | 0.15 | [0, 1] | medium |
| compositionCorrectionStrength | 0.3 | [0, 1] | medium |
| assaultWingShare | 0.6 | [0, 1] | medium |
| screenWingShare | 0.2 | [0, 1] | medium |
| maxChaseDistance | 8 | [2, 15] round | medium |
| targetDispersion | 0.5 | [0, 1] | medium |
| villageDefensePriority | 0.5 | [0, 1] | medium |
| villageRecapturePriority | 0.6 | [0, 1] | medium |
| clusterInterdictionPriority | 0.4 | [0, 1] | medium |
| clusterIsolationCommitShare | 0.3 | [0, 1] | medium |
| clusterIsolationDuration | 5 | [1, 15] round | medium |
| frontlineMeleeShare | 0.6 | [0, 1] | medium |
| backlineRangedDistance | 3 | [1, 6] round | low |
| siegeBacklineDistance | 4 | [2, 8] round | low |
| flankCavalryShare | 0.2 | [0, 1] | medium |
| formationCohesion | 0.7 | [0, 1] | low |
| l3AcquisitionWeight | 1 | [0, 2] | medium |
| l3IronPerUnitTarget | 15 | [5, 30] round | medium |
| l2StonePerUnitTarget | 8 | [2, 20] round | medium |
| militaryLevelMixTarget | { L1: 0.6, L2: 0.3, L3: 0.1 } | normalized L1+L2+L3=1 | medium |
| militaryLevelMixCorrectionStrength | 0.4 | [0, 1] | medium |
| defenderCityHexCoverageTarget | 0.5 | [0, 1] | medium |
| defenderAssignmentPriority | 0.6 | [0, 1] | medium |
| wallBuildPerCityTarget | 2 | [0, 6] round | medium |
| wallBuildPriority | 0.4 | [0, 1] | medium |
| wallToDefenderSynergyWeight | 0.5 | [0, 1] | low |

## Exploration levels

- **Low**: stable, small mutation steps by default (e.g. recruit counts, formation cohesion).
- **Medium**: standard exploration (most params).
- **High**: (none currently; reserved for future high-variance params).

## Consistency

- **AiParams** and **DEFAULT_AI_PARAMS** must have exactly the keys in **EVOLVABLE_PARAM_KEYS** (`aiParamsSchema.ts`).
- All evolution paths (train-ai, tournament-league, sim-system mutation) use **mutateParams** from the schema so every evolvable param is mutated with the same ranges.
- Run **`npm run validate-ai-params`** (or `scripts/validate-ai-params.ts`) to check keys and ranges; build should fail if missing/orphan keys exist (unless allowlisted).

Last updated: 2025-03-04.
