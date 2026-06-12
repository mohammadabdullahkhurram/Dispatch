"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { logAudit } from "@/lib/audit";

/**
 * Permanently deletes a client. FKs cascade: tickets, chat threads +
 * messages, checklist items, documents, and roster links all go with
 * it (tasks keep their rows but lose the client reference).
 */
export function DeleteClientButton({
  clientId,
  companyName,
  currentUserId,
}: {
  clientId: string;
  companyName: string;
  currentUserId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    const supabase = createClient();

    // Audit first — after the delete there's no row to reference.
    await logAudit(supabase, {
      userId: currentUserId,
      entityType: "client",
      entityId: clientId,
      action: "client_deleted",
      details: { company_name: companyName },
    });

    const { error: deleteError } = await supabase
      .from("clients")
      .delete()
      .eq("id", clientId);

    if (deleteError) {
      setError(deleteError.message);
      setDeleting(false);
      return;
    }

    router.push("/dashboard/clients");
    router.refresh();
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="border-red-500/40 text-red-600 dark:text-red-400 hover:bg-red-500/10 hover:text-red-600 dark:text-red-400"
      >
        <Trash2 className="size-4" /> Delete Client
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete {companyName}?</DialogTitle>
            <DialogDescription>
              This is permanent. All of this client&apos;s tickets, their
              workspace chat and session history, checklist items, documents,
              and portal user links will be deleted with them. There is no
              undo.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <p className="text-sm text-muted-foreground">
                Type <span className="font-semibold text-foreground">Delete</span>{" "}
                to confirm.
              </p>
              <Input
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="Delete"
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button
                className="flex-1 bg-red-600 text-white hover:bg-red-500"
                disabled={deleting || confirmText !== "Delete"}
                onClick={handleDelete}
              >
                {deleting ? "Deleting…" : "Delete permanently"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
