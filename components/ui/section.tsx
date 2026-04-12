import { cn } from "@/lib/utils";

interface SectionProps {
  children: React.ReactNode;
  className?: string;
  /** Top hairline */
  borderTop?: boolean;
  /** Bottom hairline */
  borderBottom?: boolean;
  /** Optional section label */
  label?: string;
}

export function Section({
  children,
  className,
  borderTop = false,
  borderBottom = false,
  label,
}: SectionProps) {
  return (
    <section
      className={cn(
        borderTop && "border-t border-border",
        borderBottom && "border-b border-border",
        "py-12 md:py-14",
        className
      )}
    >
      {label ? (
        <p className="label-eyebrow mb-8">{label}</p>
      ) : null}
      {children}
    </section>
  );
}
