"use client";

import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import { useOffscreenPause } from "@/components/ui/loaders/useOffscreenPause";

const circleA =
  "M 12 8 C 14.21 8 16 9.79 16 12 C 16 14.21 14.21 16 12 16 C 9.79 16 8 14.21 8 12 C 8 9.79 9.79 8 12 8 Z";

const infinity =
  "M 12 12 C 14 8.5 19 8.5 19 12 C 19 15.5 14 15.5 12 12 C 10 8.5 5 8.5 5 12 C 5 15.5 10 15.5 12 12 Z";

const circleB =
  "M 12 16 C 14.21 16 16 14.21 16 12 C 16 9.79 14.21 8 12 8 C 9.79 8 8 9.79 8 12 C 8 14.21 9.79 16 12 16 Z";

export interface MoonwalkGlyphProps {
  className?: string;
  size?: number;
}

/**
 * Morphing circle ↔ infinity stroke animation (shared by Working… and completed tool rows).
 */
export function MoonwalkGlyph({ className, size = 20 }: MoonwalkGlyphProps) {
  const reduceMotion = useReducedMotion();
  // Pause the infinite path-morph when the glyph is scrolled offscreen or the
  // window is backgrounded — an always-running compositor animation there is
  // pure wasted GPU. We reuse the static reduced-motion path for that state.
  const { ref, paused } = useOffscreenPause<SVGSVGElement>();

  const svgProps = {
    "aria-hidden": true as const,
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none" as const,
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className: cn("text-muted-foreground shrink-0", className),
  };

  // Static glyph when motion is disabled OR the element isn't visible. The ref
  // stays attached so the IntersectionObserver/visibilitychange in
  // useOffscreenPause can flip `paused` back off and resume animating once the
  // glyph is on-screen again.
  if (reduceMotion || paused) {
    return (
      <svg ref={ref} {...svgProps}>
        <path d={infinity} />
      </svg>
    );
  }

  return (
    <motion.svg ref={ref} {...svgProps}>
      <motion.path
        animate={{
          d: [circleA, infinity, circleB, infinity, circleA],
        }}
        transition={{
          d: {
            duration: 6,
            ease: "easeInOut",
            repeat: Infinity,
            times: [0, 0.25, 0.5, 0.75, 1.0],
          },
        }}
      />
    </motion.svg>
  );
}
