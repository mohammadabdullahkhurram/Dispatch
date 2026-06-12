"use client";

import { useState } from "react";
import { ExternalLink, FileText, FolderOpen, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/empty-state";
import { AccountSettings } from "@/components/account-settings";
import { ClientTeam } from "@/components/dashboard/client-team";
import { createClient } from "@/lib/supabase/client";
import { logAudit } from "@/lib/audit";
import { formatDate } from "@/lib/format";
import type {
  ChecklistItem,
  Client,
  ClientDocument,
  ClientUser,
  UserProfile,
} from "@/lib/types";

const FULL_TABS = ["company", "account", "team", "checklist", "documents", "branding"];
const LIMITED_TABS = ["account"];

export function PortalProfile({
  userId,
  profile,
  client,
  fullAccess,
  teamMembers,
  initialChecklist,
  documents,
  initialTab,
}: {
  userId: string;
  profile: UserProfile;
  client: Client;
  fullAccess: boolean;
  teamMembers: ClientUser[];
  initialChecklist: ChecklistItem[];
  documents: ClientDocument[];
  initialTab?: string;
}) {
  const [checklist, setChecklist] = useState(initialChecklist);
  const [info, setInfo] = useState({
    company_name: client.company_name,
    contact_name: client.contact_name,
    phone: client.phone ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [uploadingItem, setUploadingItem] = useState<string | null>(null);

  const validTabs = fullAccess ? FULL_TABS : LIMITED_TABS;
  const tab = validTabs.includes(initialTab ?? "")
    ? initialTab!
    : fullAccess
      ? "company"
      : "account";

  async function saveCompanyInfo(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveMessage(null);
    const supabase = createClient();
    const { error } = await supabase
      .from("clients")
      .update({
        company_name: info.company_name,
        contact_name: info.contact_name,
        phone: info.phone || null,
      })
      .eq("id", client.id);

    if (error) {
      setSaveMessage(`Save failed: ${error.message}`);
    } else {
      setSaveMessage("Saved.");
      await logAudit(supabase, {
        userId,
        entityType: "client",
        entityId: client.id,
        action: "client_info_updated",
        details: info,
      });
    }
    setSaving(false);
  }

  async function toggleItem(item: ChecklistItem, completed: boolean) {
    const supabase = createClient();
    const completedAt = completed ? new Date().toISOString() : null;
    const { error } = await supabase
      .from("client_checklist_items")
      .update({ completed, completed_at: completedAt })
      .eq("id", item.id);
    if (error) return;

    setChecklist((prev) =>
      prev.map((i) =>
        i.id === item.id ? { ...i, completed, completed_at: completedAt } : i
      )
    );
    await logAudit(supabase, {
      userId,
      entityType: "checklist_item",
      entityId: item.id,
      action: completed ? "checklist_item_completed" : "checklist_item_reopened",
      details: { item_name: item.item_name },
    });
  }

  async function uploadItemFile(item: ChecklistItem, file: File) {
    setUploadingItem(item.id);
    const supabase = createClient();
    const path = `checklist/${client.id}/${item.id}/${file.name}`;
    const { error: uploadError } = await supabase.storage
      .from("uploads")
      .upload(path, file, { upsert: true });

    if (!uploadError) {
      const url = supabase.storage.from("uploads").getPublicUrl(path).data
        .publicUrl;
      await supabase
        .from("client_checklist_items")
        .update({ file_url: url })
        .eq("id", item.id);
      setChecklist((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, file_url: url } : i))
      );
      await logAudit(supabase, {
        userId,
        entityType: "checklist_item",
        entityId: item.id,
        action: "checklist_file_uploaded",
        details: { item_name: item.item_name, file: file.name },
      });
    }
    setUploadingItem(null);
  }

  const brandColors = client.brand_colors ?? {};
  const brandFonts = client.brand_fonts ?? {};

  return (
    <div className="flex flex-1 flex-col gap-6 p-6 md:p-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Profile</h1>
        <p className="text-sm text-muted-foreground">
          Your company details, onboarding checklist, documents, and brand kit.
        </p>
      </header>

      <Tabs defaultValue={tab} className="flex-1">
        <TabsList className="flex-wrap">
          {fullAccess && <TabsTrigger value="company">Company Info</TabsTrigger>}
          <TabsTrigger value="account">My Account</TabsTrigger>
          {fullAccess && (
            <>
              <TabsTrigger value="team">Team</TabsTrigger>
              <TabsTrigger value="checklist">Checklist</TabsTrigger>
              <TabsTrigger value="documents">Documents</TabsTrigger>
              <TabsTrigger value="branding">Branding</TabsTrigger>
            </>
          )}
        </TabsList>

        <TabsContent value="account" className="mt-4">
          <AccountSettings profile={profile} />
        </TabsContent>

        {fullAccess && (
          <TabsContent value="team" className="mt-4">
            <ClientTeam clientId={client.id} initialMembers={teamMembers} />
          </TabsContent>
        )}

        <TabsContent value="company" className="mt-4">
          <Card className="max-w-xl">
            <CardHeader>
              <CardTitle className="text-base">Company information</CardTitle>
              <CardDescription>
                Keep your contact details up to date.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={saveCompanyInfo} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="company">Company name</Label>
                  <Input
                    id="company"
                    value={info.company_name}
                    onChange={(e) =>
                      setInfo({ ...info, company_name: e.target.value })
                    }
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="contact">Contact name</Label>
                  <Input
                    id="contact"
                    value={info.contact_name}
                    onChange={(e) =>
                      setInfo({ ...info, contact_name: e.target.value })
                    }
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" value={client.email} disabled />
                  <p className="text-xs text-muted-foreground">
                    Email changes go through your account manager.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="phone">Phone</Label>
                  <Input
                    id="phone"
                    value={info.phone}
                    onChange={(e) => setInfo({ ...info, phone: e.target.value })}
                    placeholder="+1 (555) 000-0000"
                  />
                </div>
                {saveMessage && (
                  <p
                    className={
                      saveMessage === "Saved."
                        ? "text-sm text-emerald-400"
                        : "text-sm text-destructive"
                    }
                  >
                    {saveMessage}
                  </p>
                )}
                <Button type="submit" disabled={saving}>
                  {saving ? "Saving…" : "Save changes"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="checklist" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Onboarding checklist</CardTitle>
              <CardDescription>
                Complete each item — attach files where requested.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {checklist.length === 0 ? (
                <EmptyState
                  icon={FileText}
                  title="No checklist items"
                  description="Your onboarding checklist will appear here once it's set up."
                />
              ) : (
                <ul className="divide-y divide-border">
                  {checklist.map((item) => (
                    <li
                      key={item.id}
                      className="flex flex-wrap items-center gap-3 py-3"
                    >
                      <Checkbox
                        checked={item.completed}
                        onCheckedChange={(checked) =>
                          toggleItem(item, checked === true)
                        }
                        aria-label={`Mark ${item.item_name} ${item.completed ? "incomplete" : "complete"}`}
                      />
                      <div className="min-w-0 flex-1">
                        <p
                          className={
                            item.completed
                              ? "text-sm font-medium text-muted-foreground line-through"
                              : "text-sm font-medium"
                          }
                        >
                          {item.item_name}
                          {item.required && (
                            <span className="ml-1.5 text-xs text-orange-400">
                              required
                            </span>
                          )}
                        </p>
                        {item.description && (
                          <p className="text-xs text-muted-foreground">
                            {item.description}
                          </p>
                        )}
                      </div>
                      {item.file_url && (
                        <a
                          href={item.file_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                        >
                          <FileText className="size-3.5" /> View file
                        </a>
                      )}
                      <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
                        <Upload className="size-3.5" />
                        {uploadingItem === item.id ? "Uploading…" : "Upload"}
                        <input
                          type="file"
                          className="sr-only"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) uploadItemFile(item, file);
                          }}
                        />
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="documents" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Documents</CardTitle>
              <CardDescription>
                Shared docs and links from your Bluejaypro team.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {client.google_drive_folder_url && (
                <a
                  href={client.google_drive_folder_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 rounded-lg border border-border p-3 transition-colors hover:border-primary/50"
                >
                  <FolderOpen className="size-5 text-primary" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">Shared Drive folder</p>
                    <p className="text-xs text-muted-foreground">
                      All your project files in one place
                    </p>
                  </div>
                  <ExternalLink className="size-4 text-muted-foreground" />
                </a>
              )}
              {documents.length === 0 && !client.google_drive_folder_url ? (
                <EmptyState
                  icon={FileText}
                  title="No documents yet"
                  description="Documents your team shares will appear here."
                />
              ) : (
                <ul className="space-y-2">
                  {documents.map((doc) => (
                    <li key={doc.id}>
                      <a
                        href={doc.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-3 rounded-lg border border-border p-3 transition-colors hover:border-primary/50"
                      >
                        <FileText className="size-5 text-primary" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">
                            {doc.title}
                          </p>
                          {doc.description && (
                            <p className="truncate text-xs text-muted-foreground">
                              {doc.description}
                            </p>
                          )}
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {formatDate(doc.created_at)}
                        </span>
                        <ExternalLink className="size-4 text-muted-foreground" />
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="branding" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Brand kit</CardTitle>
              <CardDescription>
                The logo, colors, and fonts we use for your campaigns.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Logo
                </p>
                {client.logo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={client.logo_url}
                    alt={`${client.company_name} logo`}
                    className="h-20 w-auto rounded-lg border border-border bg-white/5 p-2"
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No logo uploaded yet — your team can add one, or upload below.
                  </p>
                )}
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
                  <Upload className="size-3.5" /> Upload logo
                  <input
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const supabase = createClient();
                      const path = `logos/${client.id}/${file.name}`;
                      const { error } = await supabase.storage
                        .from("uploads")
                        .upload(path, file, { upsert: true });
                      if (!error) {
                        const url = supabase.storage
                          .from("uploads")
                          .getPublicUrl(path).data.publicUrl;
                        await supabase
                          .from("clients")
                          .update({ logo_url: url })
                          .eq("id", client.id);
                        await logAudit(supabase, {
                          userId,
                          entityType: "client",
                          entityId: client.id,
                          action: "logo_uploaded",
                        });
                        window.location.reload();
                      }
                    }}
                  />
                </label>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Colors
                </p>
                {Object.keys(brandColors).length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No brand colors on file yet.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-3">
                    {Object.entries(brandColors).map(([name, hex]) => (
                      <div key={name} className="text-center">
                        <span
                          className="block size-12 rounded-lg border border-border"
                          style={{ backgroundColor: String(hex) }}
                          title={String(hex)}
                        />
                        <p className="mt-1 text-xs capitalize">{name}</p>
                        <p className="font-mono text-[10px] text-muted-foreground">
                          {String(hex)}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Fonts
                </p>
                {Object.keys(brandFonts).length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No brand fonts on file yet.
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {Object.entries(brandFonts).map(([usage, font]) => (
                      <li key={usage} className="text-sm">
                        <span className="capitalize text-muted-foreground">
                          {usage}:
                        </span>{" "}
                        <span className="font-medium">{String(font)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
