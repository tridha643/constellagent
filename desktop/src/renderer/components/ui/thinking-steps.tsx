"use client";

import {
  useRef,
  forwardRef,
  type ReactNode,
  type HTMLAttributes,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { useIcon } from "@/lib/icon-context";
import type { IconName } from "@/lib/icon-context";
import { springs } from "@/lib/springs";
import { fontWeights } from "@/lib/font-weight";
import { useShape } from "@/lib/shape-context";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import type { BadgeColor } from "@/components/ui/badge";

// ─── ThinkingSteps (root) ───────────────────────────────────────────────────

interface ThinkingStepsProps {
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
  className?: string;
}

const ThinkingSteps = forwardRef<HTMLDivElement, ThinkingStepsProps>(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  ({ defaultOpen = true, open, onOpenChange, children, className }, ref) => {
    const controlled = open !== undefined;
    return (
      <Accordion
        ref={ref}
        type="single"
        collapsible
        {...(controlled
          ? { value: open ? "thinking" : "" }
          : { defaultValue: defaultOpen ? "thinking" : "" }
        )}
        onValueChange={
          onOpenChange ? (v: string) => onOpenChange(v === "thinking") : undefined
        }
        className={cn("w-80 max-w-full", className)}
      >
        {/* Hide standalone accordion expanded bg */}
        <AccordionItem value="thinking" className="[&>.absolute]:hidden">
          {children}
        </AccordionItem>
      </Accordion>
    );
  }
);
ThinkingSteps.displayName = "ThinkingSteps";

// ─── ThinkingStepsHeader ────────────────────────────────────────────────────

interface ThinkingStepsHeaderProps extends HTMLAttributes<HTMLButtonElement> {
  children?: ReactNode;
}

const ThinkingStepsHeader = forwardRef<
  HTMLButtonElement,
  ThinkingStepsHeaderProps
>(({ children = "Thinking", className, ...props }, ref) => {
  return (
    <div className="w-fit">
      <AccordionTrigger
        ref={ref}
        className={cn("[&>span:first-child]:flex-none w-auto", className)}
        {...props}
      >
        {children}
      </AccordionTrigger>
    </div>
  );
});
ThinkingStepsHeader.displayName = "ThinkingStepsHeader";

// ─── ThinkingStepsContent ───────────────────────────────────────────────────

interface ThinkingStepsContentProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

const ThinkingStepsContent = forwardRef<
  HTMLDivElement,
  ThinkingStepsContentProps
>(({ children, className, ...props }, ref) => {
  return (
    <AccordionContent>
      <div
        ref={ref}
        className={cn("flex flex-col", className)}
        {...props}
      >
        {children}
      </div>
    </AccordionContent>
  );
});
ThinkingStepsContent.displayName = "ThinkingStepsContent";

// ─── ThinkingStep ───────────────────────────────────────────────────────────

type StepStatus = "complete" | "active" | "pending" | "failed";

interface ThinkingStepProps {
  icon?: IconName;
  showIcon?: boolean;
  label: string;
  description?: string;
  status?: StepStatus;
  index: number;
  delay?: number;
  isLast?: boolean;
  children?: ReactNode;
  className?: string;
  /**
   * When true, pending steps render as a dimmed row instead of being hidden.
   * Default false keeps progressive “thinking” UIs unchanged.
   */
  showPending?: boolean;
}

function ThinkingStep({
  icon = "dot",
  showIcon = true,
  label,
  description,
  status = "complete",
  index,
  delay = 0,
  isLast = false,
  children,
  className,
  showPending = false,
}: ThinkingStepProps) {
  const Icon = useIcon(icon);
  const shape = useShape();

  const isFailed = status === "failed";
  const isActive = status === "active";
  const isPending = status === "pending";
  const shouldShow = status !== "pending" || showPending;

  return (
    <AnimatePresence initial={false} mode="popLayout">
      {shouldShow ? (
        <motion.div
          key={`thinking-step-${index}-${label}`}
          className={cn("relative z-10 grid min-h-0 overflow-hidden", className)}
          initial={{ gridTemplateRows: "0fr" }}
          animate={{ gridTemplateRows: "1fr" }}
          exit={{ gridTemplateRows: "0fr", opacity: 0 }}
          transition={springs.layout}
        >
          {/* Inner: min-h-0 lets 0fr/1fr rows collapse without animating height (compositor-friendlier). */}
          <div className="min-h-0 overflow-hidden">
          {/* Inner: fades content in after space starts opening */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.24, delay: 0.08, ease: "easeOut" }}
          >
            {/* Content row — this is the proximity hover target */}
            <div className={cn("flex gap-2.5 px-2 py-1.5", shape.item)}>
              {/* Icon column with continuous connector line */}
              <div className="flex flex-col items-center shrink-0 w-[14px]">
                <div className="pt-0.5">
                  {showIcon ? (
                    <Icon
                      size={14}
                      strokeWidth={1.5}
                      className={cn(
                        "text-muted-foreground",
                        isFailed && "text-destructive",
                        isActive && "text-primary",
                      )}
                    />
                  ) : (
                    <div className="w-[14px] h-[14px] flex items-center justify-center">
                      <div
                        className={cn(
                          "w-1.5 h-1.5 rounded-full",
                          isFailed && "bg-destructive",
                          isActive && "bg-primary shadow-[0_0_0_3px_hsl(var(--primary)/0.2)]",
                          !isFailed &&
                            !isActive &&
                            (isPending
                              ? "bg-muted-foreground/35"
                              : "bg-muted-foreground/60"),
                        )}
                      />
                    </div>
                  )}
                </div>
                {/* Line stretches from icon to bottom of this step */}
                {!isLast && (
                  <div
                    className={cn(
                      "flex-1 w-px mt-1",
                      isFailed ? "bg-destructive/35" : "bg-border/60",
                    )}
                  />
                )}
              </div>

              {/* Text content */}
              <div className="flex-1 flex flex-col gap-1 min-w-0">
                <span
                  className={cn(
                    "text-[13px] leading-tight",
                    isActive && !isFailed && "shimmer-text",
                    isFailed && "text-destructive",
                    isPending && "text-muted-foreground",
                  )}
                  style={{ fontVariationSettings: fontWeights.medium }}
                >
                  {label}
                  {isActive && !isFailed && "…"}
                </span>
                {description && (
                  <span
                    className={cn(
                      "text-[12px] leading-snug whitespace-pre-wrap",
                      isFailed
                        ? "text-destructive/90"
                        : "text-muted-foreground",
                    )}
                  >
                    {description}
                  </span>
                )}
                {children}
              </div>
            </div>
          </motion.div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

// ─── ThinkingStepDetails (nested accordion) ────────────────────────────────

interface ThinkingStepDetailsProps {
  summary: string;
  details?: string[];
  defaultOpen?: boolean;
  children?: ReactNode;
  className?: string;
}

function ThinkingStepDetails({
  summary,
  details,
  defaultOpen = false,
  children,
  className,
}: ThinkingStepDetailsProps) {
  const shape = useShape();

  return (
    <Accordion
      type="single"
      collapsible
      defaultValue={defaultOpen ? "details" : ""}
      className={cn("mt-1 -ml-3", className)}
    >
      <AccordionItem value="details" className="[&>.absolute]:hidden">
        <AccordionTrigger
          className={cn(
            "[&>span:first-child]:flex-none w-fit py-1 px-3 gap-1.5",
            shape.item
          )}
        >
          {summary}
        </AccordionTrigger>
        <AccordionContent>
          <div className="flex flex-col gap-0.5 pt-0.5">
            {details?.map((item, i) => (
              <span
                key={i}
                className="text-[12px] text-muted-foreground leading-snug"
              >
                {item}
              </span>
            ))}
            {children}
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

// ─── ThinkingStepSources ────────────────────────────────────────────────────

interface ThinkingStepSourcesProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

const ThinkingStepSources = forwardRef<HTMLDivElement, ThinkingStepSourcesProps>(
  ({ children, className, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn("flex flex-wrap gap-1.5 mt-1", className)}
        {...props}
      >
        {children}
      </div>
    );
  }
);
ThinkingStepSources.displayName = "ThinkingStepSources";

// ─── ThinkingStepSource ─────────────────────────────────────────────────────

interface ThinkingStepSourceProps {
  color?: BadgeColor;
  delay?: number;
  children: ReactNode;
  className?: string;
}

function ThinkingStepSource({ color = "gray", delay = 0, children, className }: ThinkingStepSourceProps) {
  return (
    <motion.span
      initial={{ opacity: 0, scale: 0.85, filter: "blur(2px)" }}
      animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
      transition={{
        ...springs.moderate,
        delay,
        filter: { duration: 0.12, delay },
      }}
    >
      <Badge variant="solid" size="sm" color={color} className={className}>
        {children}
      </Badge>
    </motion.span>
  );
}
ThinkingStepSource.displayName = "ThinkingStepSource";

// ─── ThinkingStepImage ──────────────────────────────────────────────────────

interface ThinkingStepImageProps {
  src: string;
  alt?: string;
  caption?: string;
  delay?: number;
  className?: string;
}

function ThinkingStepImage({ src, alt = "", caption, delay = 0, className }: ThinkingStepImageProps) {
  const shape = useShape();
  return (
    <motion.div
      className={cn("mt-1.5", className)}
      initial={{ opacity: 0, filter: "blur(2px)" }}
      animate={{ opacity: 1, filter: "blur(0px)" }}
      transition={{
        opacity: { duration: 0.2, delay, ease: "easeOut" },
        filter: { duration: 0.15, delay },
      }}
    >
      <img
        src={src}
        alt={alt}
        className={cn(
          "w-full max-w-[200px] object-cover",
          shape.container
        )}
      />
      {caption && (
        <span className="text-[11px] text-muted-foreground mt-1 block">
          {caption}
        </span>
      )}
    </motion.div>
  );
}
ThinkingStepImage.displayName = "ThinkingStepImage";

// ─── Exports ────────────────────────────────────────────────────────────────

export {
  ThinkingSteps,
  ThinkingStepsHeader,
  ThinkingStepsContent,
  ThinkingStep,
  ThinkingStepDetails,
  ThinkingStepSources,
  ThinkingStepSource,
  ThinkingStepImage,
};

export type {
  ThinkingStepsProps,
  ThinkingStepsHeaderProps,
  ThinkingStepsContentProps,
  ThinkingStepProps,
  ThinkingStepDetailsProps,
  ThinkingStepSourcesProps,
  ThinkingStepSourceProps,
  ThinkingStepImageProps,
  StepStatus,
};
