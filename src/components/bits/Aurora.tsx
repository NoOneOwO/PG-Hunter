/**
 * Aurora — React Bits-style animated background.
 *
 * Four soft radial-gradient blobs drift on transform/opacity only (no filter
 * blur on large elements, no layout reads), so it stays cheap enough to sit
 * behind the pixel hero without dropping frames. Under
 * `prefers-reduced-motion` the blobs freeze at their base positions.
 *
 * The component renders no text and ignores pointer events: it is wallpaper.
 */
import { motion, useReducedMotion } from 'motion/react';

interface BlobSpec {
  /** Position and size of the gradient's centre. */
  left: string;
  top: string;
  size: string;
  color: string;
  duration: number;
  /** Drift amplitude in px. */
  drift: number;
  delay?: number;
}

const BLOBS: BlobSpec[] = [
  { left: '-12%', top: '-28%', size: '72vmax', color: 'rgba(122, 66, 230, 0.34)', duration: 21, drift: 46 },
  { left: '58%', top: '-34%', size: '64vmax', color: 'rgba(168, 141, 246, 0.30)', duration: 26, drift: 38, delay: 3 },
  { left: '30%', top: '38%', size: '56vmax', color: 'rgba(56, 189, 248, 0.22)', duration: 31, drift: 30, delay: 1.4 },
  { left: '-8%', top: '52%', size: '50vmax', color: 'rgba(250, 204, 21, 0.16)', duration: 24, drift: 34, delay: 2.2 },
];

export default function Aurora({ className = '' }: { className?: string }) {
  const reduced = useReducedMotion();

  return (
    <div aria-hidden="true" className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}>
      {BLOBS.map((blob, index) =>
        reduced ? (
          <div
            key={index}
            className="absolute rounded-full"
            style={{
              left: blob.left,
              top: blob.top,
              width: blob.size,
              height: blob.size,
              background: `radial-gradient(circle at center, ${blob.color}, transparent 62%)`,
            }}
          />
        ) : (
          <motion.div
            key={index}
            className="absolute rounded-full"
            style={{
              left: blob.left,
              top: blob.top,
              width: blob.size,
              height: blob.size,
              background: `radial-gradient(circle at center, ${blob.color}, transparent 62%)`,
            }}
            animate={{
              x: [0, blob.drift, -blob.drift * 0.6, 0],
              y: [0, -blob.drift * 0.8, blob.drift * 0.5, 0],
              scale: [1, 1.06, 0.97, 1],
            }}
            transition={{
              duration: blob.duration,
              delay: blob.delay ?? 0,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
          />
        )
      )}
    </div>
  );
}
