"use client";

import { forwardRef, useState, useEffect, type HTMLAttributes } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import { fontWeights } from "@/lib/font-weight";
import { MoonwalkGlyph } from "@/components/ui/moonwalk-glyph";
import { THINKING_CYCLING_LABELS } from "@/components/ui/thinking-activity-copy";

const ThinkingIndicator = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => {
  const [index, setIndex] = useState(0);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const interval = setInterval(() => {
      setIndex((i) => (i + 1) % THINKING_CYCLING_LABELS.length);
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div
      ref={ref}
      role="status"
      className={cn("flex items-center gap-2 px-3 py-2", className)}
      {...props}
    >
      <MoonwalkGlyph />
      <span
        className="inline-grid text-[13px] overflow-hidden"
        style={{ fontVariationSettings: fontWeights.medium }}
      >
        <span
          className="col-start-1 row-start-1 invisible shimmer-text"
          aria-hidden="true"
        >
          {THINKING_CYCLING_LABELS.reduce((a, b) => (a.length >= b.length ? a : b))}
        </span>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={THINKING_CYCLING_LABELS[index]}
            className="col-start-1 row-start-1 shimmer-text"
            initial={
              reduceMotion
                ? { opacity: 0 }
                : { transform: "translateY(75%)", opacity: 0 }
            }
            animate={
              reduceMotion
                ? { opacity: 1 }
                : { transform: "translateY(0)", opacity: 1 }
            }
            exit={
              reduceMotion
                ? { opacity: 0, transition: { duration: 0.1, ease: [0.23, 1, 0.32, 1] } }
                : {
                    transform: "translateY(-75%)",
                    opacity: 0,
                    transition: { duration: 0.14, ease: [0.23, 1, 0.32, 1] },
                  }
            }
            transition={{
              duration: reduceMotion ? 0.12 : 0.2,
              ease: [0.23, 1, 0.32, 1],
            }}
          >
            {THINKING_CYCLING_LABELS[index]}
          </motion.span>
        </AnimatePresence>
      </span>
    </div>
  );
});

ThinkingIndicator.displayName = "ThinkingIndicator";

export { ThinkingIndicator };
export default ThinkingIndicator;
