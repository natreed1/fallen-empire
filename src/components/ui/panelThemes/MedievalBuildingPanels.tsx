'use client';

import Image from 'next/image';
import type { ReactNode } from 'react';

type Variant = 'university' | 'barracks' | 'buildersHut';

const PANEL: Record<
  Variant,
  { wrap: string; inner: string; titleClass: string; art: string; artBg: string }
> = {
  university: {
    wrap: 'panel-university',
    inner: 'panel-university-inner',
    titleClass: 'university-title',
    art: '/sprites/buildings/university.png',
    artBg: 'bg-stone-950/50 border-amber-900/35',
  },
  barracks: {
    wrap: 'panel-barracks',
    inner: 'panel-barracks-inner',
    titleClass: 'barracks-title',
    art: '/sprites/buildings/barracks.png',
    artBg: 'bg-stone-950/40 border-amber-900/40',
  },
  buildersHut: {
    wrap: 'panel-builders-hut',
    inner: 'panel-builders-hut-inner',
    titleClass: 'builders-hut-title',
    art: '/sprites/buildings/academy.png',
    artBg: 'bg-stone-900/50 border-amber-950/40',
  },
};

type Props = {
  variant: Variant;
  title?: ReactNode;
  titleAs?: 'h2' | 'h3' | 'div';
  headerRight?: ReactNode;
  children: ReactNode;
  className?: string;
  innerClassName?: string;
  scroll?: boolean;
  /** Hide the pixel portrait (e.g. tight layouts) */
  hideArt?: boolean;
};

/**
 * Medieval-themed building side panels: aged parchment (university),
 * military (barracks), or Builder's Hut (academy building).
 */
export function MedievalBuildingPanel({
  variant,
  title,
  titleAs: TitleTag = 'h3',
  headerRight,
  children,
  className = '',
  innerClassName = '',
  scroll = false,
  hideArt = false,
}: Props) {
  const cfg = PANEL[variant];
  const showHeader = title != null || headerRight != null || !hideArt;

  return (
    <div className={`${cfg.wrap} ${className}`.trim()}>
      <div
        className={`${cfg.inner} p-3 ${scroll ? 'medieval-building-scroll overflow-y-auto max-h-full' : ''} ${innerClassName}`.trim()}
      >
        {showHeader && (
          <div className="flex justify-between items-start gap-2 mb-2 shrink-0">
            <div className="flex gap-2.5 min-w-0 flex-1 items-start">
              {!hideArt && (
                <div
                  className={`shrink-0 w-[52px] h-[52px] rounded-md border p-0.5 shadow-inner ${cfg.artBg}`}
                  title=""
                >
                  <Image
                    src={cfg.art}
                    alt=""
                    width={48}
                    height={48}
                    className="w-12 h-12 object-contain [image-rendering:pixelated]"
                  />
                </div>
              )}
              <div className="min-w-0 flex-1">
                {title != null && title !== undefined && (
                  <TitleTag className={`${cfg.titleClass} text-sm leading-tight`}>{title}</TitleTag>
                )}
              </div>
            </div>
            {headerRight}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
