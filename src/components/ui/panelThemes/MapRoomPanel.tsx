import type { ReactNode } from 'react';

type MapRoomPanelProps = {
  title?: ReactNode;
  titleAs?: 'h2' | 'h3' | 'div';
  headerRight?: ReactNode;
  children: ReactNode;
  className?: string;
  innerClassName?: string;
  scroll?: boolean;
};

export function MapRoomPanel({
  title,
  titleAs: TitleTag = 'h3',
  headerRight,
  children,
  className = '',
  innerClassName = '',
  scroll = false,
}: MapRoomPanelProps) {
  const showHeader = title != null || headerRight != null;
  return (
    <div className={`panel-map ${className}`.trim()}>
      <div
        className={`panel-map-inner p-3 ${scroll ? 'map-scroll overflow-y-auto max-h-full' : ''} ${innerClassName}`.trim()}
      >
        {showHeader && (
          <div className="flex justify-between items-center gap-2 mb-2 shrink-0">
            <div className="min-w-0 flex-1">
              {title !== undefined && title !== null && (
                <TitleTag className="map-title text-sm font-normal">{title}</TitleTag>
              )}
            </div>
            {headerRight}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
