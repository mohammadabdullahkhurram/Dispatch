"use client";

import { useEffect } from "react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";

/** Online = seen within this window. */
export const ONLINE_WINDOW_MS = 5 * 60 * 1000;

export function isOnline(lastSeen: string | null | undefined): boolean {
  if (!lastSeen) return false;
  return Date.now() - new Date(lastSeen).getTime() < ONLINE_WINDOW_MS;
}

/**
 * Stamps users.last_seen now and every 2 minutes while the tab is
 * open, so other users can show a green/grey presence dot.
 */
export function usePresenceHeartbeat(userId: string) {
  useEffect(() => {
    const supabase = createClient();
    let active = true;
    const beat = () => {
      if (!active || document.hidden) return;
      supabase
        .from("users")
        .update({ last_seen: new Date().toISOString() })
        .eq("id", userId)
        .then(() => {});
    };
    beat();
    const interval = setInterval(beat, 120_000);
    document.addEventListener("visibilitychange", beat);
    return () => {
      active = false;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", beat);
    };
  }, [userId]);
}

/** Small status dot overlaid on an avatar. */
export function PresenceDot({
  online,
  className,
}: {
  online: boolean;
  className?: string;
}) {
  return (
    <span
      title={online ? "Online" : "Offline"}
      className={cn(
        "absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-card",
        online ? "bg-emerald-500" : "bg-muted-foreground/40",
        className
      )}
    />
  );
}
