"use client";

import { STEPS } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

interface StepperProps {
  currentStep: number;
}

export function Stepper({ currentStep }: StepperProps) {
  return (
    <nav
      className="mb-8 border-b border-border pb-8 md:mb-10 md:pb-10"
      aria-label="Progress"
    >
      <div className="relative flex justify-between px-1">
        <div
          className="pointer-events-none absolute left-[12%] right-[12%] top-[7px] h-px bg-border"
          aria-hidden
        />
        {STEPS.map((step) => {
          const done = currentStep > step.id;
          const active = currentStep === step.id;

          return (
            <div
              key={step.id}
              className="relative z-10 flex w-[22%] max-w-[140px] flex-col items-center"
            >
              <div
                className={cn(
                  "flex h-[15px] w-[15px] shrink-0 items-center justify-center border bg-background transition-colors",
                  done
                    ? "border-foreground bg-foreground text-primary-foreground"
                    : active
                      ? "animate-blue-glow"
                      : "border-border"
                )}
                style={active ? { borderColor: "var(--blue)" } : undefined}
                aria-current={active ? "step" : undefined}
              >
                {done ? (
                  <Check className="h-2.5 w-2.5" strokeWidth={2.5} />
                ) : (
                  <span
                    className="font-mono text-[8px] tabular-nums"
                    style={active ? { color: "var(--blue)" } : undefined}
                  >
                    {step.id}
                  </span>
                )}
              </div>
              {/* On mobile: show label only for active/done; hide inactive to save space */}
              <p
                className={cn(
                  "mt-2 text-center text-[10px] font-medium uppercase tracking-[0.12em] transition-opacity md:mt-3 md:tracking-[0.14em]",
                  done
                    ? "text-foreground"
                    : active
                      ? "opacity-100"
                      : "opacity-0 sm:opacity-100"
                )}
                style={active ? { color: "var(--blue)" } : undefined}
              >
                {step.label}
              </p>
              <p className="mt-1 hidden text-center text-[11px] leading-snug text-muted-foreground md:block">
                {step.description}
              </p>
            </div>
          );
        })}
      </div>
    </nav>
  );
}
