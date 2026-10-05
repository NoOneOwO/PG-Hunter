/**
 * SpotlightCard — React Bits-style cursor spotlight.
 *
 * A radial gradient follows the pointer across the card (one CSS variable
 * write per mousemove, composited by the GPU). Keyboard users and touch get
 * the plain card; nothing about the spotlight is load-bearing.
 */
import { useRef, type ReactNode, type CSSProperties, type MouseEvent } from 'react';

interface SpotlightCardProps {
  children: ReactNode;
  className?: string;
  /** Spotlight tint. Defaults to the brand violet. */
  color?: string;
  style?: CSSProperties;
}

export default function SpotlightCard({ children, className = '', color = 'rgba(122, 66, 230, 0.14)', style }: SpotlightCardProps) {
  const ref = useRef<HTMLDivElement>(null);

  const onMove = (event: MouseEvent<HTMLDivElement>) => {
    const node = ref.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    node.style.setProperty('--spot-x', `${event.clientX - rect.left}px`);
    node.style.setProperty('--spot-y', `${event.clientY - rect.top}px`);
  };

  return (
    <div
      ref={ref}
      onMouseMove={onMove}
      className={`spotlight-card relative ${className}`}
      style={{ '--spotlight-color': color, ...style } as CSSProperties}
    >
      {children}
    </div>
  );
}
