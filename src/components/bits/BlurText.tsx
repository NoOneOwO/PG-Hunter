/**
 * BlurText — React Bits-style entrance for a headline.
 *
 * Splits the string into words and stagger-animates each one from blurred +
 * dropped to crisp, so the hero reads as one fluid reveal rather than a fade
 * on the whole block. Runs once on mount; `prefers-reduced-motion` renders
 * the plain text with no animation.
 *
 * Only transform/opacity/filter animate, so it never triggers layout.
 */
import { motion, useReducedMotion } from 'motion/react';

interface BlurTextProps {
  text: string;
  className?: string;
  /** Seconds before the first word starts. */
  delay?: number;
  /** Seconds between word starts. */
  stagger?: number;
}

export default function BlurText({ text, className = '', delay = 0, stagger = 0.05 }: BlurTextProps) {
  const reduced = useReducedMotion();
  const words = text.split(/(\s+)/);

  if (reduced) return <span className={className}>{text}</span>;

  return (
    <span className={`inline-block ${className}`} aria-label={text}>
      {words.map((word, index) => {
        // Keep the original spaces so line wrapping still works; only real
        // words get the animation.
        if (/^\s+$/.test(word)) return <span key={index}>{' '}</span>;
        return (
          <motion.span
            key={index}
            aria-hidden="true"
            className="inline-block will-change-transform"
            initial={{ opacity: 0, y: 10, filter: 'blur(10px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            transition={{
              duration: 0.55,
              delay: delay + index * stagger,
              ease: [0.16, 1, 0.3, 1],
            }}
          >
            {word}
          </motion.span>
        );
      })}
    </span>
  );
}
