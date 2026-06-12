"use client";

import { useEffect, useState } from "react";
import { slaRemaining } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Timer } from "lucide-react";

/** Live SLA countdown — re-renders every 30s, red when breached. */
export function SlaCountdown({
  deadline,
  resolved,
}: {
  deadline: string | null;
  resolved?: boolean;
}) {
  const [, tick] = useState(0);

  useEffect(() => {
    if (!deadline || resolved) return;
    const interval = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(interval);
  }, [deadline, resolved]);

  if (resolved) {
    return <span className="text-xs text-muted-foreground">Resolved</span>;
  }

  const { label, breached, urgent } = slaRemaining(deadline);

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs tabular-nums",
        breached
          ? "sla-breached font-semibold"
          : urgent
            ? "text-orange-600 dark:text-orange-400"
            : "text-muted-foreground"
      )}
    >
      <Timer className="size-3.5" />
      {label}
    </span>
  );
}
