/**
 * Diagnostic: ensure AiParams, DEFAULT_AI_PARAMS, and mutation space are consistent.
 * Prints total keys, mutated keys, missing (in type/defaults but not mutated), orphan (mutated but not in type).
 * Exits with code 1 if missing or orphan sets are non-empty (unless allowlisted).
 *
 * Run: npx ts-node -r tsconfig-paths/register --project tsconfig.train.json scripts/validate-ai-params.ts
 * Allowlist: VALIDATE_AI_PARAMS_ALLOWLIST=key1,key2 (comma-separated keys to allow in missing/orphan)
 */

import { DEFAULT_AI_PARAMS, type AiParams } from '../src/lib/ai';
import {
  EVOLVABLE_PARAM_KEYS,
  SCALAR_PARAM_KEYS,
  MUTATION_EXCLUDED_KEYS,
  MUTATION_RANGES,
  assertAiParamsConsistency,
  getMutationSpaceSummary,
} from '../src/lib/aiParamsSchema';

const ALLOWLIST_ENV = process.env.VALIDATE_AI_PARAMS_ALLOWLIST ?? '';
const ALLOWLIST = new Set(ALLOWLIST_ENV ? ALLOWLIST_ENV.split(',').map(k => k.trim()).filter(Boolean) : []);

function main(): void {
  const defaultKeys = new Set(Object.keys(DEFAULT_AI_PARAMS) as (keyof AiParams)[]);
  const evolvableSet = new Set(EVOLVABLE_PARAM_KEYS);
  const mutatedKeys = new Set(EVOLVABLE_PARAM_KEYS.filter(k => !MUTATION_EXCLUDED_KEYS.includes(k)));

  // Keys in AiParams/DEFAULT that are not in mutation space (missing from mutation)
  const inDefaultsNotMutated = [...defaultKeys].filter(k => !mutatedKeys.has(k as (typeof EVOLVABLE_PARAM_KEYS)[number]));
  // Keys in mutation space that are not in DEFAULT_AI_PARAMS (orphan)
  const mutatedNotInDefaults = [...mutatedKeys].filter(k => !defaultKeys.has(k));

  console.log('=== AI params consistency ===');
  console.log('Total AiParams / DEFAULT_AI_PARAMS keys:', defaultKeys.size);
  console.log('Total EVOLVABLE_PARAM_KEYS:', EVOLVABLE_PARAM_KEYS.length);
  console.log('Scalar keys (for trend/reports):', SCALAR_PARAM_KEYS.length);
  console.log('Keys in mutation space:', mutatedKeys.size);
  console.log('Keys excluded from mutation:', MUTATION_EXCLUDED_KEYS.length);
  if (MUTATION_EXCLUDED_KEYS.length > 0) {
    console.log('  Excluded:', MUTATION_EXCLUDED_KEYS.join(', '));
  }
  console.log('');

  const summary = getMutationSpaceSummary();
  console.log('Mutation space summary:');
  console.log('  Params in mutation space:', summary.paramsInMutationSpace.join(', '));
  console.log('  Excluded from mutation:', summary.excludedFromMutation.join(', ') || 'none');
  console.log('  Reason:', summary.excludedReason);
  console.log('');

  const missing = inDefaultsNotMutated.filter(k => !ALLOWLIST.has(k));
  const orphan = mutatedNotInDefaults.filter(k => !ALLOWLIST.has(k));

  if (missing.length > 0) {
    console.log('Missing (in DEFAULT_AI_PARAMS but not in mutation space):', missing.join(', '));
  }
  if (orphan.length > 0) {
    console.log('Orphan (in mutation space but not in DEFAULT_AI_PARAMS):', orphan.join(', '));
  }

  try {
    assertAiParamsConsistency();
    console.log('assertAiParamsConsistency(): OK');
  } catch (e) {
    console.error('assertAiParamsConsistency(): FAILED', (e as Error).message);
    process.exit(1);
  }

  if (missing.length > 0 || orphan.length > 0) {
    if (ALLOWLIST.size > 0) {
      console.log('Allowlist active:', [...ALLOWLIST].join(', '));
      const missingNotAllowlisted = inDefaultsNotMutated.filter(k => !ALLOWLIST.has(k));
      const orphanNotAllowlisted = mutatedNotInDefaults.filter(k => !ALLOWLIST.has(k));
      if (missingNotAllowlisted.length > 0 || orphanNotAllowlisted.length > 0) {
        console.error('Missing or orphan keys are not fully allowlisted. Failing.');
        process.exit(1);
      }
    } else {
      console.error('Missing or orphan sets are non-empty. Build fails. Use VALIDATE_AI_PARAMS_ALLOWLIST to allowlist if intentional.');
      process.exit(1);
    }
  }

  console.log('');
  console.log('Mutation ranges (scalar):');
  for (const key of SCALAR_PARAM_KEYS) {
    const r = MUTATION_RANGES[key];
    console.log(`  ${key}: [${r.min}, ${r.max}]${r.round ? ' round' : ''} exploration=${r.exploration ?? 'medium'}`);
  }
  console.log('  militaryLevelMixTarget: structured (L1,L2,L3 normalized)');
  console.log('');
  console.log('Validation passed.');
}

main();
