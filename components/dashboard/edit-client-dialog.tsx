"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { logAudit } from "@/lib/audit";
import type { Client } from "@/lib/types";

export function EditClientDialog({
  client,
  currentUserId,
}: {
  client: Client;
  currentUserId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState({
    company_name: client.company_name,
    contact_name: client.contact_name,
    email: client.email,
    phone: client.phone ?? "",
    google_drive_folder_url: client.google_drive_folder_url ?? "",
  });

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const supabase = createClient();
    const { error: updateError } = await supabase
      .from("clients")
      .update({
        company_name: draft.company_name.trim(),
        contact_name: draft.contact_name.trim() || draft.company_name.trim(),
        email: draft.email.trim().toLowerCase(),
        phone: draft.phone.trim() || null,
        google_drive_folder_url: draft.google_drive_folder_url.trim() || null,
      })
      .eq("id", client.id);

    if (updateError) {
      setError(
        updateError.code === "23505"
          ? "Another client already uses this email."
          : updateError.message
      );
      setSaving(false);
      return;
    }

    await logAudit(supabase, {
      userId: currentUserId,
      entityType: "client",
      entityId: client.id,
      action: "client_updated",
      details: { company_name: draft.company_name.trim() },
    });

    setOpen(false);
    setSaving(false);
    router.refresh();
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Pencil className="size-4" /> Edit
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit client</DialogTitle>
            <DialogDescription>
              Changes apply immediately and are audit-logged.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="ec-company">Company name</Label>
              <Input
                id="ec-company"
                required
                value={draft.company_name}
                onChange={(e) =>
                  setDraft({ ...draft, company_name: e.target.value })
                }
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="ec-contact">Contact name</Label>
                <Input
                  id="ec-contact"
                  value={draft.contact_name}
                  onChange={(e) =>
                    setDraft({ ...draft, contact_name: e.target.value })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ec-email">Email</Label>
                <Input
                  id="ec-email"
                  type="email"
                  required
                  value={draft.email}
                  onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ec-phone">Phone</Label>
              <Input
                id="ec-phone"
                type="tel"
                value={draft.phone}
                onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
                placeholder="+1 555 123 4567"
              />
              <p className="text-xs text-muted-foreground">
                SMS and call matching key on this number.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ec-drive">Google Drive folder URL</Label>
              <Input
                id="ec-drive"
                type="url"
                value={draft.google_drive_folder_url}
                onChange={(e) =>
                  setDraft({ ...draft, google_drive_folder_url: e.target.value })
                }
                placeholder="https://drive.google.com/drive/folders/…"
              />
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <Button
              type="submit"
              className="w-full"
              disabled={saving || !draft.company_name.trim() || !draft.email.trim()}
            >
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
