'use client';

import type { ArmyStance } from '@/types/game';
import { ARMY_STANCE_OPTIONS } from '@/lib/armyCommand';

const CHIP: Record<ArmyStance, { idle: string; active: string }> = {
  aggressive: {
    idle: 'border-red-500/35 text-red-200/65 hover:bg-red-950/35',
    active: 'border-red-400/75 bg-red-950/55 text-red-100 ring-1 ring-red-500/35',
  },
  defensive: {
    idle: 'border-sky-500/35 text-sky-200/65 hover:bg-sky-950/35',
    active: 'border-sky-400/75 bg-sky-950/55 text-sky-100 ring-1 ring-sky-500/35',
  },
  hold_the_line: {
    idle: 'border-amber-500/35 text-amber-200/65 hover:bg-amber-950/35',
    active: 'border-amber-400/75 bg-amber-950/55 text-amber-100 ring-1 ring-amber-500/35',
  },
  skirmish: {
    idle: 'border-cyan-500/35 text-cyan-200/65 hover:bg-cyan-950/35',
    active: 'border-cyan-400/75 bg-cyan-950/55 text-cyan-100 ring-1 ring-cyan-500/35',
  },
  passive: {
    idle: 'border-empire-stone/40 text-empire-parchment/50 hover:bg-empire-stone/20',
    active: 'border-empire-stone/70 bg-empire-stone/25 text-empire-parchment/90 ring-1 ring-empire-stone/40',
  },
};

export function StanceChips({
  current,
  onChange,
  compact = false,
}: {
  current: ArmyStance | null;
  onChange: (stance: ArmyStance) => void;
  compact?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-0.5" role="group" aria-label="Combat stance">
      {ARMY_STANCE_OPTIONS.map(opt => {
        const active = current === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            title={opt.hint}
            onClick={() => onChange(opt.id)}
            className={`${compact ? 'px-1 py-0.5 text-[8px]' : 'px-1.5 py-0.5 text-[10px]'} rounded border capitalize transition-colors ${
              active ? CHIP[opt.id].active : CHIP[opt.id].idle
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
