"use client";

import {
  forwardRef,
  useImperativeHandle,
  useRef,
  useEffect,
  useLayoutEffect,
} from "react";
import { Send, Loader2, CornerDownLeft } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  sending?: boolean;
  disabled?: boolean;
  placeholder?: string;
  hint?: string;
}

export interface ComposerHandle {
  focus: () => void;
}

const MAX_H = 220;

export const Composer = forwardRef<ComposerHandle, Props>(function Composer(
  { value, onChange, onSend, sending, disabled, placeholder, hint },
  ref,
) {
  const taRef = useRef<HTMLTextAreaElement>(null);

  useImperativeHandle(ref, () => ({
    focus: () => taRef.current?.focus(),
  }));

  useLayoutEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(MAX_H, el.scrollHeight) + "px";
  }, [value]);

  useEffect(() => {
    taRef.current?.focus();
  }, []);

  const canSend = value.trim().length > 0 && !sending && !disabled;

  return (
    <div
      className={cn(
        "sticky bottom-0 z-10 border-t border-[var(--border)] bg-[var(--background)]/95",
        "px-3 pb-3 pt-2.5 backdrop-blur-md lg:px-5",
      )}
    >
      <div className="mx-auto max-w-3xl">
        <div
          className={cn(
            "group rounded-2xl border border-[var(--border)] bg-[var(--card)]",
            "focus-within:border-[var(--control-border-hover)]",
            "focus-within:shadow-[0_1px_0_0_var(--border),0_0_0_3px_var(--blue-subtle)]",
            "transition-shadow",
          )}
        >
          <textarea
            ref={taRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSend();
              }
            }}
            placeholder={placeholder || "Décrivez ce que vous voulez…"}
            rows={1}
            className={cn(
              "block w-full resize-none bg-transparent px-3.5 py-3 text-[13.5px] leading-relaxed",
              "placeholder:text-[var(--muted-foreground)] focus:outline-none",
            )}
            style={{ maxHeight: MAX_H }}
          />
          <div className="flex items-center justify-between px-3 pb-2 pt-0">
            <p className="text-[10.5px] text-[var(--muted-foreground)]">
              {hint || (
                <>
                  <kbd className="rounded border border-[var(--border)] bg-[var(--background)] px-1 py-0 font-mono text-[10px]">
                    Entrée
                  </kbd>{" "}
                  envoyer ·{" "}
                  <kbd className="rounded border border-[var(--border)] bg-[var(--background)] px-1 py-0 font-mono text-[10px]">
                    Shift+↵
                  </kbd>{" "}
                  nouvelle ligne
                </>
              )}
            </p>
            <button
              onClick={onSend}
              disabled={!canSend}
              className={cn(
                "inline-flex h-7 items-center gap-1 rounded-md px-2.5 text-[11.5px] font-semibold transition-all",
                canSend
                  ? "bg-[var(--foreground)] text-[var(--primary-foreground)] hover:opacity-90"
                  : "bg-[var(--muted)] text-[var(--muted-foreground)] opacity-60",
              )}
            >
              {sending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" strokeWidth={2} />
              )}
              <span>Envoyer</span>
              <CornerDownLeft className="h-3 w-3" strokeWidth={2} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});
