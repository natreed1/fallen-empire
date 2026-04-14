import type { ReactNode } from 'react';

type BuilderCottagePanelProps = {
  title?: ReactNode;
  titleAs?: 'h2' | 'h3' | 'div';
  children: ReactNode;
  className?: string;
  innerClassName?: string;
  scroll?: boolean;
};

export function BuilderCottagePanel({
  title,
  titleAs: TitleTag = 'h3',
  children,
  className = '',
  innerClassName = '',
  scroll = false,
}: BuilderCottagePanelProps) {
  return (
    <div className={`panel-cottage ${className}`.trim()}>
      <div
        className={`panel-cottage-inner p-3 ${scroll ? 'cottage-scroll overflow-y-auto max-h-full' : ''} ${innerClassName}`.trim()}
      >
        {title !== undefined && title !== null && (
          <TitleTag className="cottage-title text-xs font-bold uppercase tracking-wide mb-2">{title}</TitleTag>
        )}
        {children}
      </div>
    </div>
  );
}
