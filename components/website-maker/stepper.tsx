"use client";

import { STEPS } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

interface StepperProps {
  currentStep: number;
}

export function Stepper({ currentStep }: StepperProps) {
  return (
    <div className="flex items-center justify-center gap-0 mb-8">
      {STEPS.map((step, index) => (
        <div key={step.id} className="flex items-center">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                "flex items-center justify-center w-9 h-9 rounded-full text-sm font-semibold transition-all duration-300",
                currentStep > step.id
                  ? "bg-primary text-primary-foreground"
                  : currentStep === step.id
                  ? "bg-primary text-primary-foreground animate-pulse-ring"
                  : "bg-secondary text-muted-foreground"
              )}
            >
              {currentStep > step.id ? (
                <Check className="w-4 h-4" />
              ) : (
                step.id
              )}
            </div>
            <div className="hidden sm:block">
              <p
                className={cn(
                  "text-sm font-medium transition-colors",
                  currentStep >= step.id
                    ? "text-foreground"
                    : "text-muted-foreground"
                )}
              >
                {step.label}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {step.description}
              </p>
            </div>
          </div>
          {index < STEPS.length - 1 && (
            <div
              className={cn(
                "w-12 sm:w-20 h-[2px] mx-3 rounded-full transition-all duration-500",
                currentStep > step.id ? "bg-primary" : "bg-secondary"
              )}
            />
          )}
        </div>
      ))}
    </div>
  );
}
