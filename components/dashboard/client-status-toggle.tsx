"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Power } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { logAudit } from "@/lib/audit";
import type { ClientStatus } from "@/lib/types";

/**
 * Deactivate/reactivate a client. Inactive: hidden from the default
 * list, chat threads closed, portal access blocked. Reactivating
 * reopens their threads.
 */
export function ClientStatusToggle({
  clientId,
  companyName,
  status,
  currentUserId,
}: {
  clientId: string;
  companyName: string;
  status: ClientStatus;
  currentUserId: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const nextStatus: ClientStatus = status === "active" ? "inactive" : "active";

    const { error: clientError } = await supabase
      .from("clients")
      .update({ status: nextStatus })
      .eq("id", clientId);

    if (clientError) {
      setError(clientError.message);
      setBusy(false);
      return;
    }

    // Threads follow the client: closed when inactive, reopened on
    // reactivation.
    const { error: threadError } = await supabase
      .from("chat_threads")
      .update({ status: nextStatus === "inactive" ? "closed" : "active" })
      .eq("client_id", clientId);

    if (threadError) {
      setError(`Client updated, but threads failed: ${threadError.message}`);
    }

    await logAudit(supabase, {
      userId: currentUserId,
      entityType: "client",
      entityId: clientId,
      action:
        nextStatus === "inactive" ? "client_deactivated" : "client_reactivated",
      details: { company_name: companyName },
    });

    setBusy(false);
    router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="outline"
        size="sm"
        onClick={toggle}
        disabled={busy}
        className={
          status === "active"
            ? "border-red-500/40 text-red-400 hover:bg-red-500/10 hover:text-red-400"
            : "border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-400"
        }
      >
        <Power className="size-4" />
        {busy
          ? "Updating…"
          : status === "active"
            ? "Mark as Inactive"
            : "Mark as Active"}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
