import { cn } from "@/lib/utils";

export function UserEvent({ content }: { content: string }) {
  return (
    <div className="flex w-full justify-end animate-fade-in">
      <div
        className={cn(
          "max-w-[88%] rounded-2xl rounded-br-sm px-4 py-2.5",
          "bg-[var(--foreground)] text-[var(--primary-foreground)]",
          "text-[13.5px] leading-relaxed whitespace-pre-wrap",
          "shadow-sm",
        )}
      >
        {content}
      </div>
    </div>
  );
}
