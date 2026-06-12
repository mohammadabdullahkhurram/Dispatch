"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

const MAX_HEIGHT = 144; // ~6 lines

/**
 * Auto-expanding chat input — grows with content up to ~6 lines.
 * Enter sends (via onSend), Shift+Enter inserts a newline.
 */
export const ChatTextarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea"> & { onSend?: () => void }
>(function ChatTextarea({ className, onSend, onKeyDown, value, ...props }, ref) {
  const innerRef = React.useRef<HTMLTextAreaElement | null>(null);
  React.useImperativeHandle(ref, () => innerRef.current!, []);

  // Resize on every value change, including programmatic clears.
  React.useEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }, [value]);

  return (
    <textarea
      ref={innerRef}
      rows={1}
      value={value}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          onSend?.();
        }
        onKeyDown?.(e);
      }}
      className={cn(
        "max-h-36 w-full min-w-0 resize-none overflow-y-auto rounded-md border border-input bg-card px-3 py-2 text-sm transition-colors outline-none placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  );
});
