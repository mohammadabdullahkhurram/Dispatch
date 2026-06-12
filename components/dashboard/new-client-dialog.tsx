"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { logAudit } from "@/lib/audit";

export function NewClientDialog({
  currentUserId,
}: {
  currentUserId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState({
    company_name: "",
    contact_name: "",
    email: "",
    phone: "",
    google_drive_folder_url: "",
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const supabase = createClient();
    const { data: client, error: insertError } = await supabase
      .from("clients")
      .insert({
        company_name: draft.company_name.trim(),
        // contact_name is NOT NULL in the schema — fall back to company.
        contact_name: draft.contact_name.trim() || draft.company_name.trim(),
        email: draft.email.trim().toLowerCase(),
        phone: draft.phone.trim() || null,
        google_drive_folder_url: draft.google_drive_folder_url.trim() || null,
        onboarding_status: "not_started",
      })
      .select("id, company_name")
      .single();

    if (insertError || !client) {
      setError(
        insertError?.code === "23505"
          ? "A client with this email already exists."
          : (insertError?.message ?? "Failed to create client.")
      );
      setSaving(false);
      return;
    }

    // The 004 after-insert trigger has already applied all checklist
    // templates to the new client at this point.
    await logAudit(supabase, {
      userId: currentUserId,
      entityType: "client",
      entityId: client.id,
      action: "client_created",
      details: { company_name: client.company_name },
    });

    setOpen(false);
    router.push(`/dashboard/clients/${client.id}`);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" /> New Client
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New client</DialogTitle>
          <DialogDescription>
            The current checklist templates are applied to their onboarding
            automatically.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="nc-company">Company name</Label>
            <Input
              id="nc-company"
              required
              value={draft.company_name}
              onChange={(e) =>
                setDraft({ ...draft, company_name: e.target.value })
              }
              placeholder="Acme Co."
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="nc-contact">Contact name</Label>
              <Input
                id="nc-contact"
                value={draft.contact_name}
                onChange={(e) =>
                  setDraft({ ...draft, contact_name: e.target.value })
                }
                placeholder="Jane Smith"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nc-email">Contact email</Label>
              <Input
                id="nc-email"
                type="email"
                required
                value={draft.email}
                onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                placeholder="jane@acme.com"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="nc-phone">Contact phone</Label>
            <Input
              id="nc-phone"
              type="tel"
              value={draft.phone}
              onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
              placeholder="+1 555 123 4567"
            />
            <p className="text-xs text-muted-foreground">
              Include the country code — SMS routing matches on this number.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="nc-drive">Google Drive folder URL (optional)</Label>
            <Input
              id="nc-drive"
              type="url"
              value={draft.google_drive_folder_url}
              onChange={(e) =>
                setDraft({ ...draft, google_drive_folder_url: e.target.value })
              }
              placeholder="https://drive.google.com/drive/folders/…"
            />
          </div>

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}

          <Button
            type="submit"
            className="w-full"
            disabled={saving || !draft.company_name.trim() || !draft.email.trim()}
          >
            {saving ? "Creating…" : "Create client"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
