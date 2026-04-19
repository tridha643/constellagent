"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";

/**
 * Cross-fade two icons (scale + opacity + blur) per make-interfaces-feel-better.
 * Spring with bounce 0 when motion is enabled; instant swap when reduced motion.
 */
export function IconSwap({
  active,
  a,
  b,
  size = 16,
}: {
  active: boolean;
  a: ReactNode;
  b: ReactNode;
  size?: number;
}) {
  const reduceMotion = useReducedMotion();

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
          initial={{ scale: 0.25, opacity: 0, filter: "blur(4px)" }}
          animate={{ scale: 1, opacity: 1, filter: "blur(0px)" }}
          exit={{ scale: 0.25, opacity: 0, filter: "blur(4px)" }}
          transition={{ type: "spring", duration: 0.3, bounce: 0 }}
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
