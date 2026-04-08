import type { Unit } from '@/types/game';
import type { MajorEngagementDoctrine } from '@/types/game';
import { inferEnemyTacticLabel } from '@/lib/majorEngagement';

/**
 * Pick a doctrine for AI based on enemy composition label (simple counter table).
 */
export function pickAiMajorEngagementDoctrine(_myUnits: Unit[], enemyUnits: Unit[]): MajorEngagementDoctrine {
  const label = inferEnemyTacticLabel(enemyUnits);
  switch (label) {
    case 'Mobile strike':
      return 'hold_the_line';
    case 'Ranged skirmish':
      return 'shield_wall';
    case 'Heavy infantry':
      return 'flank_emphasis';
    case 'Siege train':
      return 'cavalry_push';
    case 'Mixed line':
    default:
      return 'balanced';
  }
}
