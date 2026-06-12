"use client";

import { useState } from "react";
import { Plus, Trash2, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/empty-state";
import { UserAvatar } from "@/components/user-avatar";
import { formatDate } from "@/lib/format";
import {
  CLIENT_ROLE_LABELS,
  isClientAdminRole,
  type ClientUser,
  type ClientUserRole,
} from "@/lib/types";

const ROLE_OPTIONS: ClientUserRole[] = [
  "account_owner",
  "account_admin",
  "office_member",
  "contractor",
];

export function ClientTeam({
  clientId,
  initialMembers,
}: {
  clientId: string;
  initialMembers: ClientUser[];
}) {
  const [members, setMembers] = useState(initialMembers);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({
    email: "",
    full_name: "",
    role: "office_member" as ClientUserRole,
  });
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  async function addUser(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setWarning(null);

    const res = await fetch(`/api/clients/${clientId}/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
    const data = (await res.json().catch(() => ({}))) as {
      member?: ClientUser;
      warning?: string | null;
      error?: string;
    };

    if (!res.ok || !data.member) {
      setError(data.error ?? `Failed to add user (HTTP ${res.status}).`);
      setSaving(false);
      return;
    }

    setMembers((prev) => [...prev, data.member!]);
    if (data.warning) setWarning(data.warning);
    setDraft({ email: "", full_name: "", role: "office_member" });
    setOpen(false);
    setSaving(false);
  }

  async function removeUser(member: ClientUser) {
    setRemoving(member.user_id);
    setError(null);
    setWarning(null);

    const res = await fetch(
      `/api/clients/${clientId}/users?userId=${encodeURIComponent(member.user_id)}`,
      { method: "DELETE" }
    );
    const data = (await res.json().catch(() => ({}))) as {
      removed?: boolean;
      warning?: string | null;
      error?: string;
    };

    if (!res.ok) {
      setError(data.error ?? `Failed to remove user (HTTP ${res.status}).`);
    } else {
      setMembers((prev) => prev.filter((m) => m.user_id !== member.user_id));
      if (data.warning) setWarning(data.warning);
    }
    setRemoving(null);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {members.length} user{members.length === 1 ? "" : "s"} can sign in to
          this client&apos;s portal. SMS from their tagged GHL contacts routes
          into Dispatch chat.
        </p>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="size-4" /> Add User
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Add user</DialogTitle>
              <DialogDescription>
                Creates their Dispatch login and tags their GHL contact
                &quot;dispatch-user&quot;.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={addUser} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="cu-name">Full name</Label>
                <Input
                  id="cu-name"
                  required
                  value={draft.full_name}
                  onChange={(e) =>
                    setDraft({ ...draft, full_name: e.target.value })
                  }
                  placeholder="Jane Smith"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cu-email">Email</Label>
                <Input
                  id="cu-email"
                  type="email"
                  required
                  value={draft.email}
                  onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                  placeholder="jane@client.com"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Role</Label>
                <Select
                  value={draft.role}
                  onValueChange={(v) =>
                    setDraft({ ...draft, role: v as ClientUserRole })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLE_OPTIONS.map((role) => (
                      <SelectItem key={role} value={role}>
                        {CLIENT_ROLE_LABELS[role]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button
                type="submit"
                className="w-full"
                disabled={saving || !draft.email.trim() || !draft.full_name.trim()}
              >
                {saving ? "Adding…" : "Add user"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {error && !open && <p className="text-sm text-destructive">{error}</p>}
      {warning && (
        <p className="rounded-md border border-orange-500/30 bg-orange-500/10 px-3 py-2 text-sm text-orange-400">
          {warning}
        </p>
      )}

      {members.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No users yet"
          description="Add the people at this client who should have portal and SMS access."
        />
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {members.map((member) => (
            <li key={member.id} className="flex items-center gap-3 px-4 py-3">
              <UserAvatar
                name={member.user?.full_name}
                avatarUrl={member.user?.avatar_url}
                className="size-8"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {member.user?.full_name ?? "Unknown user"}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {member.user?.email}
                </p>
              </div>
              <Badge
                variant="outline"
                className={
                  isClientAdminRole(member.role)
                    ? "border-primary/30 bg-primary/10 text-primary"
                    : ""
                }
              >
                {CLIENT_ROLE_LABELS[member.role]}
              </Badge>
              {member.user?.ghl_contact_id ? (
                <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
                  GHL tagged
                </Badge>
              ) : (
                <Badge variant="outline" className="text-muted-foreground">
                  No GHL link
                </Badge>
              )}
              <span className="hidden text-xs text-muted-foreground sm:block">
                Added {formatDate(member.created_at)}
              </span>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => removeUser(member)}
                disabled={removing === member.user_id}
                aria-label={`Remove ${member.user?.full_name ?? "user"}`}
              >
                <Trash2 className="size-4 text-muted-foreground" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
