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
      className="mb-10 border-b border-border pb-10"
      aria-label="Progress"
    >
      <div className="relative flex justify-between px-1">
        <div
          className="pointer-events-none absolute left-[12%] right-[12%] top-[7px] h-px bg-black/[0.08]"
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
                      ? "border-foreground"
                      : "border-border"
                )}
                aria-current={active ? "step" : undefined}
              >
                {done ? (
                  <Check className="h-2.5 w-2.5" strokeWidth={2.5} />
                ) : (
                  <span className="font-mono text-[8px] tabular-nums text-muted-foreground">
                    {step.id}
                  </span>
                )}
              </div>
              <p
                className={cn(
                  "mt-3 text-center text-[10px] font-medium uppercase tracking-[0.14em]",
                  active || done ? "text-foreground" : "text-muted-foreground"
                )}
              >
                {step.label}
              </p>
              <p className="mt-1 hidden text-center text-[11px] leading-snug text-muted-foreground sm:block">
                {step.description}
              </p>
            </div>
          );
        })}
      </div>
    </nav>
  );
}
