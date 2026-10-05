/**
 * CountUp — React Bits-style number entrance.
 *
 * Animates from 0 to `to` with motion's tween and writes the value straight
 * into the DOM node, so React never re-renders per frame. en-IN grouping is
 * the default formatter (₹-region stats read 1,24,000). Under reduced motion
 * the final value renders immediately.
 */
import { useEffect, useRef } from 'react';
import { animate, useReducedMotion } from 'motion/react';

interface CountUpProps {
  to: number;
  duration?: number;
  delay?: number;
  className?: string;
  /** Override the en-IN grouping if a value needs its own shape. */
  format?: (value: number) => string;
}

const enIN = new Intl.NumberFormat('en-IN');

export default function CountUp({ to, duration = 1.6, delay = 0.2, className = '', format }: CountUpProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduced = useReducedMotion();
  const formatValue = format ?? ((value: number) => enIN.format(Math.round(value)));

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    if (reduced) {
      node.textContent = formatValue(to);
      return;
    }

    const controls = animate(0, to, {
      duration,
      delay,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (value) => {
        node.textContent = formatValue(value);
      },
      onComplete: () => {
        node.textContent = formatValue(to);
      },
    });
    return () => controls.stop();
    // `formatValue` is captured; callers pass a stable formatter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [to, duration, delay, reduced]);

  return (
    <span ref={ref} className={className}>
      {formatValue(0)}
    </span>
  );
}
