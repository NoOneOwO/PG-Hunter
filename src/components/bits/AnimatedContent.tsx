/**
 * AnimatedContent — React Bits-style scroll reveal for React islands.
 *
 * Static Astro pages use the global `data-reveal` system instead; this is the
 * equivalent for content inside a React island (where server-rendered data
 * attributes would not re-bind after client mounts).
 */
import { motion, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';

interface AnimatedContentProps {
  children: ReactNode;
  className?: string;
  /** Seconds of delay before the entrance starts. */
  delay?: number;
  /** Travel distance in px. */
  distance?: number;
}

export default function AnimatedContent({ children, className = '', delay = 0, distance = 24 }: AnimatedContentProps) {
  const reduced = useReducedMotion();

  if (reduced) return <div className={className}>{children}</div>;

  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: distance }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.7, delay, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  );
}
