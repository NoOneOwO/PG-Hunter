import * as React from "react";
import { cn } from "cn";
import { mountScene } from "@/lib/pixel";

/**
 * PixelBanner — the strip at the top of the profile.
 *
 * Thin React wrapper around the shared pixel engine: the scene itself
 * (`skyline`) lives in src/lib/pixel/scenes-impl.ts alongside every other
 * scene on the site, so the banner and the page backdrops cannot drift apart.
 * The engine owns buffer sizing, the frame budget, reduced-motion, and
 * pausing when the banner scrolls out of view.
 */

export interface PixelBannerProps {
  className?: string;
}

export function PixelBanner({ className }: PixelBannerProps) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const teardown = mountScene(canvas, "skyline", { targetPixels: 8, maxCols: 170 });
    return () => teardown?.();
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={cn("block h-full w-full", className)}
      style={{ imageRendering: "pixelated" }}
    />
  );
}

export default PixelBanner;