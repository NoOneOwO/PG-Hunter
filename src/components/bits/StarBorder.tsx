/**
 * StarBorder — React Bits-style animated border.
 *
 * Two gradient streaks orbit the border on conic-gradient rotation via
 * `transform: rotate` of oversized pseudo-layers, clipped by the card. Pure
 * CSS keyframes (defined in global.css), so no JS runs; reduced-motion stops
 * the rotation there too.
 */
import type { ReactNode, CSSProperties } from 'react';

interface StarBorderProps {
  children: ReactNode;
  className?: string;
  /** One orbit, seconds. */
  duration?: number;
  /** Tailwind-compatible padding for the inner content. */
  contentClassName?: string;
  style?: CSSProperties;
}

export default function StarBorder({ children, className = '', duration = 8, contentClassName = '', style }: StarBorderProps) {
  return (
    <div
      className={`star-border relative overflow-hidden ${className}`}
      style={{ '--star-duration': `${duration}s`, ...style } as CSSProperties}
      aria-hidden="false"
    >
      <span className="star-border__ray star-border__ray--a" aria-hidden="true" />
      <span className="star-border__ray star-border__ray--b" aria-hidden="true" />
      <div className={`relative z-10 ${contentClassName}`}>{children}</div>
    </div>
  );
}
