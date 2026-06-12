"use client";

import { useState } from "react";
import { ListChecks, Pencil, Plus, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/empty-state";
import { createClient } from "@/lib/supabase/client";
import { logAudit } from "@/lib/audit";
import type { ChecklistTemplate, Client } from "@/lib/types";

type ClientOption = Pick<Client, "id" | "company_name">;

export function ChecklistTemplates({
  currentUserId,
  initialTemplates,
  clients,
}: {
  currentUserId: string;
  initialTemplates: ChecklistTemplate[];
  clients: ClientOption[];
}) {
  const [templates, setTemplates] = useState(initialTemplates);
  const [draft, setDraft] = useState({ item_name: "", description: "", required: true });
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ChecklistTemplate | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [applying, setApplying] = useState<ChecklistTemplate | null>(null);
  const [selectedClients, setSelectedClients] = useState<Set<string>>(new Set());
  const [allClients, setAllClients] = useState(false);
  const [applyBusy, setApplyBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  function flash(text: string, ok = true) {
    setMessage({ text, ok });
    setTimeout(() => setMessage(null), 5000);
  }

  async function createTemplate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("checklist_templates")
      .insert({
        item_name: draft.item_name.trim(),
        description: draft.description.trim() || null,
        required: draft.required,
        created_by: currentUserId,
      })
      .select()
      .single();

    if (error || !data) {
      flash(`Create failed: ${error?.message}`, false);
    } else {
      setTemplates((prev) => [...prev, data as ChecklistTemplate]);
      setDraft({ item_name: "", description: "", required: true });
      await logAudit(supabase, {
        userId: currentUserId,
        entityType: "checklist_template",
        entityId: data.id,
        action: "checklist_template_created",
        details: { item_name: data.item_name },
      });
    }
    setCreating(false);
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setSavingEdit(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("checklist_templates")
      .update({
        item_name: editing.item_name.trim(),
        description: editing.description?.trim() || null,
        required: editing.required,
      })
      .eq("id", editing.id);

    if (error) {
      flash(`Save failed: ${error.message}`, false);
    } else {
      setTemplates((prev) =>
        prev.map((t) => (t.id === editing.id ? { ...editing } : t))
      );
      await logAudit(supabase, {
        userId: currentUserId,
        entityType: "checklist_template",
        entityId: editing.id,
        action: "checklist_template_updated",
        details: { item_name: editing.item_name },
      });
      setEditing(null);
    }
    setSavingEdit(false);
  }

  async function deleteTemplate(template: ChecklistTemplate) {
    const supabase = createClient();
    const { error } = await supabase
      .from("checklist_templates")
      .delete()
      .eq("id", template.id);

    if (error) {
      flash(`Delete failed: ${error.message}`, false);
      return;
    }
    setTemplates((prev) => prev.filter((t) => t.id !== template.id));
    await logAudit(supabase, {
      userId: currentUserId,
      entityType: "checklist_template",
      entityId: template.id,
      action: "checklist_template_deleted",
      details: { item_name: template.item_name },
    });
  }

  function openApply(template: ChecklistTemplate) {
    setApplying(template);
    setSelectedClients(new Set());
    setAllClients(false);
  }

  async function applyToClients() {
    if (!applying) return;
    const targets = allClients
      ? clients.map((c) => c.id)
      : Array.from(selectedClients);
    if (targets.length === 0) return;

    setApplyBusy(true);
    const supabase = createClient();

    // Skip clients that already have an item with this name.
    const { data: existing } = await supabase
      .from("client_checklist_items")
      .select("client_id")
      .eq("item_name", applying.item_name)
      .in("client_id", targets);

    const alreadyHave = new Set((existing ?? []).map((r) => r.client_id));
    const inserts = targets
      .filter((id) => !alreadyHave.has(id))
      .map((clientId) => ({
        client_id: clientId,
        item_name: applying.item_name,
        description: applying.description,
        required: applying.required,
      }));

    if (inserts.length > 0) {
      const { error } = await supabase
        .from("client_checklist_items")
        .insert(inserts);
      if (error) {
        flash(`Apply failed: ${error.message}`, false);
        setApplyBusy(false);
        return;
      }
    }

    await logAudit(supabase, {
      userId: currentUserId,
      entityType: "checklist_template",
      entityId: applying.id,
      action: "checklist_template_applied",
      details: {
        item_name: applying.item_name,
        applied_to: inserts.length,
        skipped_existing: alreadyHave.size,
        all_clients: allClients,
      },
    });

    flash(
      `Applied to ${inserts.length} client${inserts.length === 1 ? "" : "s"}` +
        (alreadyHave.size ? ` (${alreadyHave.size} already had it).` : ".")
    );
    setApplying(null);
    setApplyBusy(false);
  }

  return (
    <div className="space-y-6">
      {message && (
        <p
          className={
            message.ok
              ? "rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-400"
              : "rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          }
        >
          {message.text}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">New template item</CardTitle>
          <CardDescription>
            New clients receive every template item automatically on creation.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={createTemplate} className="space-y-3">
            <div className="flex flex-wrap gap-3">
              <div className="min-w-64 flex-1 space-y-1.5">
                <Label htmlFor="tpl-name">Item name</Label>
                <Input
                  id="tpl-name"
                  required
                  value={draft.item_name}
                  onChange={(e) => setDraft({ ...draft, item_name: e.target.value })}
                  placeholder="Share Google Analytics access"
                />
              </div>
              <div className="flex items-end gap-2 pb-1">
                <Checkbox
                  id="tpl-required"
                  checked={draft.required}
                  onCheckedChange={(v) => setDraft({ ...draft, required: v === true })}
                />
                <Label htmlFor="tpl-required" className="text-sm font-normal">
                  Required
                </Label>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tpl-desc">Description</Label>
              <Textarea
                id="tpl-desc"
                rows={2}
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                placeholder="What the client needs to do, and why"
              />
            </div>
            <Button type="submit" disabled={creating || !draft.item_name.trim()}>
              <Plus className="size-4" /> {creating ? "Adding…" : "Add item"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {templates.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title="No template items yet"
          description="Add your standard onboarding checklist above."
        />
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {templates.map((template) => (
            <li key={template.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {template.item_name}
                  {template.required && (
                    <span className="ml-1.5 text-xs text-orange-400">required</span>
                  )}
                </p>
                {template.description && (
                  <p className="text-xs text-muted-foreground">{template.description}</p>
                )}
              </div>
              <Button variant="outline" size="sm" onClick={() => openApply(template)}>
                <Send className="size-3.5" /> Apply to Clients
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setEditing({ ...template })}
                aria-label={`Edit ${template.item_name}`}
              >
                <Pencil className="size-4 text-muted-foreground" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => deleteTemplate(template)}
                aria-label={`Delete ${template.item_name}`}
              >
                <Trash2 className="size-4 text-muted-foreground" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {/* Edit dialog */}
      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit template item</DialogTitle>
            <DialogDescription>
              Changes apply to future uses — existing client checklists keep
              their current items.
            </DialogDescription>
          </DialogHeader>
          {editing && (
            <form onSubmit={saveEdit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="edit-name">Item name</Label>
                <Input
                  id="edit-name"
                  required
                  value={editing.item_name}
                  onChange={(e) =>
                    setEditing({ ...editing, item_name: e.target.value })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-desc">Description</Label>
                <Textarea
                  id="edit-desc"
                  rows={2}
                  value={editing.description ?? ""}
                  onChange={(e) =>
                    setEditing({ ...editing, description: e.target.value })
                  }
                />
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="edit-required"
                  checked={editing.required}
                  onCheckedChange={(v) =>
                    setEditing({ ...editing, required: v === true })
                  }
                />
                <Label htmlFor="edit-required" className="text-sm font-normal">
                  Required
                </Label>
              </div>
              <Button type="submit" className="w-full" disabled={savingEdit}>
                {savingEdit ? "Saving…" : "Save changes"}
              </Button>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Apply to clients dialog */}
      <Dialog open={!!applying} onOpenChange={(open) => !open && setApplying(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Apply &quot;{applying?.item_name}&quot;</DialogTitle>
            <DialogDescription>
              Adds this item to the selected clients&apos; checklists. Clients
              that already have it are skipped.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <label className="flex items-center gap-2 rounded-md border border-border px-3 py-2">
              <Checkbox
                checked={allClients}
                onCheckedChange={(v) => setAllClients(v === true)}
              />
              <span className="text-sm font-medium">All clients ({clients.length})</span>
            </label>

            {!allClients && (
              <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border border-border p-2">
                {clients.length === 0 ? (
                  <p className="px-2 py-1 text-sm text-muted-foreground">
                    No clients yet.
                  </p>
                ) : (
                  clients.map((client) => (
                    <label
                      key={client.id}
                      className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-accent/50"
                    >
                      <Checkbox
                        checked={selectedClients.has(client.id)}
                        onCheckedChange={(v) => {
                          setSelectedClients((prev) => {
                            const next = new Set(prev);
                            if (v === true) next.add(client.id);
                            else next.delete(client.id);
                            return next;
                          });
                        }}
                      />
                      <span className="text-sm">{client.company_name}</span>
                    </label>
                  ))
                )}
              </div>
            )}

            <Button
              className="w-full"
              onClick={applyToClients}
              disabled={applyBusy || (!allClients && selectedClients.size === 0)}
            >
              {applyBusy
                ? "Applying…"
                : `Apply to ${allClients ? clients.length : selectedClients.size} client${(allClients ? clients.length : selectedClients.size) === 1 ? "" : "s"}`}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
