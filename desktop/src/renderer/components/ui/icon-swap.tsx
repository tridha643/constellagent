"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";

/**
 * Cross-fade two icons (scale + opacity + blur) per make-interfaces-feel-better.
 * Spring with bounce 0 when motion is enabled; instant swap when reduced motion.
 */
const VARIANTS = {
  default: { initialScale: 0.25, blur: 4, duration: 0.3 },
  soft: { initialScale: 0.92, blur: 2, duration: 0.18 },
} as const;

export function IconSwap({
  active,
  a,
  b,
  size = 16,
  variant = "default",
}: {
  active: boolean;
  a: ReactNode;
  b: ReactNode;
  size?: number;
  variant?: keyof typeof VARIANTS;
}) {
  const reduceMotion = useReducedMotion();
  const variantConfig = VARIANTS[variant];

  if (reduceMotion) {
    return (
      <span
        style={{
          display: "inline-flex",
          width: size,
          height: size,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {active ? a : b}
      </span>
    );
  }

  return (
    <span
      style={{
        position: "relative",
        width: size,
        height: size,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={active ? "a" : "b"}
          initial={{ scale: variantConfig.initialScale, opacity: 0, filter: `blur(${variantConfig.blur}px)` }}
          animate={{ scale: 1, opacity: 1, filter: "blur(0px)" }}
          exit={{ scale: variantConfig.initialScale, opacity: 0, filter: `blur(${variantConfig.blur}px)` }}
          transition={{ type: "spring", duration: variantConfig.duration, bounce: 0 }}
          style={{
            position: "absolute",
            inset: 0,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {active ? a : b}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
