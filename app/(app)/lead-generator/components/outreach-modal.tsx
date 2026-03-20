"use client";

import { X, Copy, Check } from "lucide-react";
import { useState } from "react";

interface OutreachModalProps {
  businessName: string;
  template: string;
  onClose: () => void;
}

export function OutreachModal({
  businessName,
  template,
  onClose,
}: OutreachModalProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(template);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg border border-border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="text-sm font-medium text-foreground">
            Outreach — {businessName}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" strokeWidth={1.25} />
          </button>
        </div>

        <div className="p-4">
          <div className="border border-border bg-secondary/30 p-4 text-sm leading-relaxed text-foreground whitespace-pre-wrap">
            {template}
          </div>
        </div>

        <div className="flex justify-end border-t border-border px-4 py-3">
          <button type="button" onClick={handleCopy} className="btn-solid text-xs">
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5" strokeWidth={2} />
                Copied
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" strokeWidth={1.25} />
                Copy
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
