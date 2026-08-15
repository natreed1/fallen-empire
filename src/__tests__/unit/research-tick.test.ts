import { describe, expect, it } from 'vitest';
import { computeResearchPerCycle, processResearchTick } from '@/lib/researchTick';
import type { Player } from '@/types/game';
import { STARTING_TECHS, TECH_TREE } from '@/types/game';

function scholar(progress: number): Player {
  return {
    id: 'p1',
    name: 'You',
    color: '#fff',
    gold: 0,
    taxRate: 0.3,
    foodPriority: 'civilian',
    isHuman: true,
    education: { level: 1, literacy: 80 },
    researchedTechs: [...STARTING_TECHS],
    activeResearch: 'agriculture_2',
    researchProgress: progress,
  };
}

describe('research tick', () => {
  it('keeps leftover research points after a tech completes', () => {
    const cost = TECH_TREE.agriculture_2.researchCost;
    const player = scholar(cost - 1);
    const gain = computeResearchPerCycle(player, [], undefined, [], []);
    expect(gain).toBeGreaterThan(1);

    const { completedTech, player: out } = processResearchTick(player, [], [], []);
    expect(completedTech).toBe('agriculture_2');
    expect(out.activeResearch).toBeNull();
    expect(out.researchedTechs).toContain('agriculture_2');
    expect(out.researchProgress).toBeGreaterThan(0);
    expect(out.researchProgress).toBeLessThan(cost);
  });
});
