"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MessageSquareX } from "lucide-react";
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
 * Wipes the client's workspace chat (thread + all messages). A fresh
 * workspace is recreated automatically on the next bot post or visit.
 */
export function DeleteWorkspaceChatButton({
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

    await logAudit(supabase, {
      userId: currentUserId,
      entityType: "chat_thread",
      entityId: clientId,
      action: "workspace_chat_deleted",
      details: { company_name: companyName },
    });

    const { error: deleteError } = await supabase
      .from("chat_threads")
      .delete()
      .eq("client_id", clientId)
      .eq("category", "workspace");

    if (deleteError) {
      setError(deleteError.message);
      setDeleting(false);
      return;
    }

    setOpen(false);
    setConfirmText("");
    setDeleting(false);
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
        <MessageSquareX className="size-4" /> Delete Workspace Chat
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete {companyName}&apos;s workspace chat?</DialogTitle>
            <DialogDescription>
              The entire conversation history — including Dispatch Bot ticket
              updates — will be permanently deleted. A fresh, empty workspace
              chat will be created automatically. There is no undo.
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
                {deleting ? "Deleting…" : "Delete chat"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
