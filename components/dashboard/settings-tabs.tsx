"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  Check,
  Copy,
  Plug,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/empty-state";
import { UserAvatar } from "@/components/user-avatar";
import { createClient } from "@/lib/supabase/client";
import { logAudit } from "@/lib/audit";
import { formatDateTime } from "@/lib/format";
import {
  ROLE_LABELS,
  TEAM_ROLES,
  type AppSetting,
  type AuditLog,
  type CannedResponse,
  type Department,
  type UserProfile,
  type UserRole,
} from "@/lib/types";

function settingValue(settings: AppSetting[], key: string, field: string): string {
  const setting = settings.find((s) => s.key === key);
  return String(setting?.value?.[field] ?? "");
}

export function SettingsTabs({
  currentUser,
  initialSettings,
  initialTeam,
  initialDepartments,
  initialCanned,
  auditLogs,
}: {
  currentUser: UserProfile;
  initialSettings: AppSetting[];
  initialTeam: UserProfile[];
  initialDepartments: Department[];
  initialCanned: CannedResponse[];
  auditLogs: AuditLog[];
}) {
  const supabase = createClient();
  const [team, setTeam] = useState(initialTeam);
  const [departments, setDepartments] = useState(initialDepartments);
  const [canned, setCanned] = useState(initialCanned);
  const [message, setMessage] = useState<string | null>(null);

  // General
  const [general, setGeneral] = useState({
    agency_name: settingValue(initialSettings, "general", "agency_name") || "Bluejaypro",
    logo_url: settingValue(initialSettings, "general", "logo_url"),
    timezone: settingValue(initialSettings, "general", "timezone") || "America/New_York",
  });

  // Integrations
  const [integrations, setIntegrations] = useState({
    ghl_api_key: settingValue(initialSettings, "integrations", "ghl_api_key"),
    ghl_location_id: settingValue(initialSettings, "integrations", "ghl_location_id"),
  });
  const [copied, setCopied] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  // Departments
  const [newDept, setNewDept] = useState({ name: "", description: "" });

  // Canned
  const [newCanned, setNewCanned] = useState({ title: "", body: "", department_id: "" });

  // Invite
  const [invite, setInvite] = useState({
    email: "",
    role: "department_member" as UserRole,
    department_id: "",
  });

  // Audit search
  const [auditQuery, setAuditQuery] = useState("");

  const deptNames = useMemo(
    () => Object.fromEntries(departments.map((d) => [d.id, d.name])),
    [departments]
  );

  const filteredAudit = useMemo(() => {
    const q = auditQuery.trim().toLowerCase();
    if (!q) return auditLogs;
    return auditLogs.filter(
      (a) =>
        a.action.toLowerCase().includes(q) ||
        a.entity_type.toLowerCase().includes(q) ||
        (a.user?.full_name ?? "").toLowerCase().includes(q)
    );
  }, [auditLogs, auditQuery]);

  // Client-only origin, empty on the server render to avoid hydration mismatch.
  const webhookBase = useSyncExternalStore(
    () => () => {},
    () => window.location.origin,
    () => ""
  );

  function flash(text: string) {
    setMessage(text);
    setTimeout(() => setMessage(null), 4000);
  }

  async function saveSetting(key: string, value: Record<string, unknown>) {
    const { error } = await supabase
      .from("app_settings")
      .upsert({ key, value }, { onConflict: "key" });
    if (error) {
      flash(`Save failed: ${error.message}`);
      return false;
    }
    await logAudit(supabase, {
      userId: currentUser.id,
      entityType: "app_settings",
      action: "settings_updated",
      details: { key },
    });
    flash("Saved.");
    return true;
  }

  async function updateMember(member: UserProfile, patch: Partial<UserProfile>) {
    const { error } = await supabase.from("users").update(patch).eq("id", member.id);
    if (error) {
      flash(`Update failed: ${error.message}`);
      return;
    }
    setTeam((prev) => prev.map((m) => (m.id === member.id ? { ...m, ...patch } : m)));
    await logAudit(supabase, {
      userId: currentUser.id,
      entityType: "user",
      entityId: member.id,
      action: "team_member_updated",
      details: patch as Record<string, unknown>,
    });
  }

  async function createDepartment(e: React.FormEvent) {
    e.preventDefault();
    const { data, error } = await supabase
      .from("departments")
      .insert({ name: newDept.name, description: newDept.description || null })
      .select()
      .single();
    if (error || !data) {
      flash(`Create failed: ${error?.message}`);
      return;
    }
    setDepartments((prev) => [...prev, data as Department]);
    setNewDept({ name: "", description: "" });
    await logAudit(supabase, {
      userId: currentUser.id,
      entityType: "department",
      entityId: data.id,
      action: "department_created",
      details: { name: data.name },
    });
  }

  async function setDepartmentHead(dept: Department, headId: string | null) {
    const { error } = await supabase
      .from("departments")
      .update({ head_user_id: headId })
      .eq("id", dept.id);
    if (error) {
      flash(`Update failed: ${error.message}`);
      return;
    }
    setDepartments((prev) =>
      prev.map((d) => (d.id === dept.id ? { ...d, head_user_id: headId } : d))
    );
    await logAudit(supabase, {
      userId: currentUser.id,
      entityType: "department",
      entityId: dept.id,
      action: "department_head_changed",
    });
  }

  async function deleteDepartment(dept: Department) {
    const { error } = await supabase.from("departments").delete().eq("id", dept.id);
    if (error) {
      flash(`Delete failed: ${error.message}`);
      return;
    }
    setDepartments((prev) => prev.filter((d) => d.id !== dept.id));
    await logAudit(supabase, {
      userId: currentUser.id,
      entityType: "department",
      entityId: dept.id,
      action: "department_deleted",
      details: { name: dept.name },
    });
  }

  async function createCanned(e: React.FormEvent) {
    e.preventDefault();
    const { data, error } = await supabase
      .from("canned_responses")
      .insert({
        title: newCanned.title,
        body: newCanned.body,
        department_id: newCanned.department_id || null,
        created_by: currentUser.id,
      })
      .select()
      .single();
    if (error || !data) {
      flash(`Create failed: ${error?.message}`);
      return;
    }
    setCanned((prev) =>
      [...prev, data as CannedResponse].sort((a, b) => a.title.localeCompare(b.title))
    );
    setNewCanned({ title: "", body: "", department_id: "" });
    await logAudit(supabase, {
      userId: currentUser.id,
      entityType: "canned_response",
      entityId: data.id,
      action: "canned_response_created",
      details: { title: data.title },
    });
  }

  async function deleteCanned(item: CannedResponse) {
    const { error } = await supabase.from("canned_responses").delete().eq("id", item.id);
    if (error) {
      flash(`Delete failed: ${error.message}`);
      return;
    }
    setCanned((prev) => prev.filter((c) => c.id !== item.id));
    await logAudit(supabase, {
      userId: currentUser.id,
      entityType: "canned_response",
      entityId: item.id,
      action: "canned_response_deleted",
      details: { title: item.title },
    });
  }

  async function copyToClipboard(text: string, key: string) {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  }

  async function testConnection() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/webhooks/ghl-sms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ test: true, source: "settings_test" }),
      });
      setTestResult(
        res.ok ? "Webhook endpoint reachable ✓" : `Endpoint returned ${res.status}`
      );
    } catch {
      setTestResult("Could not reach the webhook endpoint.");
    }
    setTesting(false);
  }

  async function sendInvite(e: React.FormEvent) {
    e.preventDefault();
    // Real invites need the service-role admin API (server-side). Log intent for now.
    await logAudit(supabase, {
      userId: currentUser.id,
      entityType: "user",
      action: "invite_requested",
      details: invite as unknown as Record<string, unknown>,
    });
    flash(
      `Invite recorded for ${invite.email}. Hook this to a server action with the Supabase admin API to send the email.`
    );
    setInvite({ email: "", role: "department_member", department_id: "" });
  }

  return (
    <div className="flex flex-1 flex-col gap-6 p-6 md:p-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Workspace configuration, team, departments, and integrations.
        </p>
      </header>

      {message && (
        <p className="rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-sm text-primary">
          {message}
        </p>
      )}

      <Tabs defaultValue="general" className="flex-1">
        <TabsList className="flex-wrap">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="team">Team</TabsTrigger>
          <TabsTrigger value="departments">Departments</TabsTrigger>
          <TabsTrigger value="integrations">Integrations</TabsTrigger>
          <TabsTrigger value="canned">Canned Responses</TabsTrigger>
          <TabsTrigger value="audit">Audit Log</TabsTrigger>
          {/* Routes to its own page; styled to sit with the tabs. */}
          <Link
            href="/dashboard/settings/checklist-templates"
            className="inline-flex items-center gap-1 rounded-md px-3 py-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Checklist Templates <ArrowUpRight className="size-3.5" />
          </Link>
        </TabsList>

        {/* General */}
        <TabsContent value="general" className="mt-4">
          <Card className="max-w-xl">
            <CardHeader>
              <CardTitle className="text-base">Agency</CardTitle>
              <CardDescription>Basics that show up across the workspace.</CardDescription>
            </CardHeader>
            <CardContent>
              <form
                className="space-y-4"
                onSubmit={async (e) => {
                  e.preventDefault();
                  await saveSetting("general", general);
                }}
              >
                <div className="space-y-1.5">
                  <Label htmlFor="agency-name">Agency name</Label>
                  <Input
                    id="agency-name"
                    value={general.agency_name}
                    onChange={(e) => setGeneral({ ...general, agency_name: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="agency-logo">Logo URL</Label>
                  <Input
                    id="agency-logo"
                    value={general.logo_url}
                    onChange={(e) => setGeneral({ ...general, logo_url: e.target.value })}
                    placeholder="https://…"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Timezone</Label>
                  <Select
                    value={general.timezone}
                    onValueChange={(v) => setGeneral({ ...general, timezone: v })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {[
                        "America/New_York",
                        "America/Chicago",
                        "America/Denver",
                        "America/Los_Angeles",
                        "Europe/London",
                        "Asia/Karachi",
                        "Asia/Dubai",
                        "Australia/Sydney",
                      ].map((tz) => (
                        <SelectItem key={tz} value={tz}>{tz}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button type="submit">Save</Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Team */}
        <TabsContent value="team" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Invite a team member</CardTitle>
              <CardDescription>
                New members get access based on their role and department.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={sendInvite} className="flex flex-wrap items-end gap-3">
                <div className="min-w-56 flex-1 space-y-1.5">
                  <Label htmlFor="invite-email">Email</Label>
                  <Input
                    id="invite-email"
                    type="email"
                    required
                    value={invite.email}
                    onChange={(e) => setInvite({ ...invite, email: e.target.value })}
                    placeholder="teammate@bluejaypro.com"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Role</Label>
                  <Select
                    value={invite.role}
                    onValueChange={(v) => setInvite({ ...invite, role: v as UserRole })}
                  >
                    <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TEAM_ROLES.map((r) => (
                        <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Department</Label>
                  <Select
                    value={invite.department_id || "none"}
                    onValueChange={(v) =>
                      setInvite({ ...invite, department_id: v === "none" ? "" : v })
                    }
                  >
                    <SelectTrigger className="w-44"><SelectValue placeholder="None" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {departments.map((d) => (
                        <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button type="submit">
                  <Plus className="size-4" /> Invite
                </Button>
              </form>
            </CardContent>
          </Card>

          <div className="rounded-xl border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Department</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {team.map((member) => (
                  <TableRow key={member.id}>
                    <TableCell>
                      <span className="flex items-center gap-2.5">
                        <UserAvatar
                          name={member.full_name}
                          avatarUrl={member.avatar_url}
                          className="size-8"
                        />
                        <span>
                          <span className="block text-sm font-medium">{member.full_name}</span>
                          <span className="block text-xs text-muted-foreground">
                            {member.email}
                          </span>
                        </span>
                      </span>
                    </TableCell>
                    <TableCell>
                      <Select
                        value={member.role}
                        onValueChange={(v) => updateMember(member, { role: v as UserRole })}
                      >
                        <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {TEAM_ROLES.map((r) => (
                            <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Select
                        value={member.department_id ?? "none"}
                        onValueChange={(v) =>
                          updateMember(member, { department_id: v === "none" ? null : v })
                        }
                      >
                        <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">None</SelectItem>
                          {departments.map((d) => (
                            <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* Departments */}
        <TabsContent value="departments" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Create department</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={createDepartment} className="flex flex-wrap items-end gap-3">
                <div className="min-w-48 space-y-1.5">
                  <Label htmlFor="dept-name">Name</Label>
                  <Input
                    id="dept-name"
                    required
                    value={newDept.name}
                    onChange={(e) => setNewDept({ ...newDept, name: e.target.value })}
                    placeholder="SEO"
                  />
                </div>
                <div className="min-w-64 flex-1 space-y-1.5">
                  <Label htmlFor="dept-desc">Description</Label>
                  <Input
                    id="dept-desc"
                    value={newDept.description}
                    onChange={(e) => setNewDept({ ...newDept, description: e.target.value })}
                    placeholder="What this team handles"
                  />
                </div>
                <Button type="submit" disabled={!newDept.name.trim()}>
                  <Plus className="size-4" /> Create
                </Button>
              </form>
            </CardContent>
          </Card>

          {departments.length === 0 ? (
            <EmptyState
              icon={Plus}
              title="No departments"
              description="Create your first department above."
            />
          ) : (
            <div className="rounded-xl border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Department</TableHead>
                    <TableHead>Head</TableHead>
                    <TableHead className="w-16" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {departments.map((dept) => (
                    <TableRow key={dept.id}>
                      <TableCell>
                        <p className="text-sm font-medium">{dept.name}</p>
                        {dept.description && (
                          <p className="text-xs text-muted-foreground">{dept.description}</p>
                        )}
                      </TableCell>
                      <TableCell>
                        <Select
                          value={dept.head_user_id ?? "none"}
                          onValueChange={(v) =>
                            setDepartmentHead(dept, v === "none" ? null : v)
                          }
                        >
                          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">No head assigned</SelectItem>
                            {team.map((m) => (
                              <SelectItem key={m.id} value={m.id}>{m.full_name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => deleteDepartment(dept)}
                          aria-label={`Delete ${dept.name}`}
                        >
                          <Trash2 className="size-4 text-muted-foreground" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        {/* Integrations */}
        <TabsContent value="integrations" className="mt-4">
          <Card className="max-w-2xl">
            <CardHeader>
              <CardTitle className="text-base">GoHighLevel</CardTitle>
              <CardDescription>
                Point GHL&apos;s webhooks at these URLs to pipe SMS and calls into Dispatch.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {[
                { label: "SMS webhook", path: "/api/webhooks/ghl-sms" },
                { label: "Call webhook", path: "/api/webhooks/ghl-call" },
              ].map(({ label, path }) => {
                const url = `${webhookBase}${path}`;
                return (
                  <div key={path} className="space-y-1.5">
                    <Label>{label}</Label>
                    <div className="flex gap-2">
                      <Input readOnly value={url} className="font-mono text-xs" />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => copyToClipboard(url, path)}
                        aria-label={`Copy ${label} URL`}
                      >
                        {copied === path ? (
                          <Check className="size-4 text-emerald-400" />
                        ) : (
                          <Copy className="size-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                );
              })}

              <form
                className="space-y-4 border-t border-border pt-4"
                onSubmit={async (e) => {
                  e.preventDefault();
                  await saveSetting("integrations", integrations);
                }}
              >
                <div className="space-y-1.5">
                  <Label htmlFor="ghl-key">GHL API key</Label>
                  <Input
                    id="ghl-key"
                    type="password"
                    value={integrations.ghl_api_key}
                    onChange={(e) =>
                      setIntegrations({ ...integrations, ghl_api_key: e.target.value })
                    }
                    placeholder="ghl_…"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ghl-location">GHL location ID</Label>
                  <Input
                    id="ghl-location"
                    value={integrations.ghl_location_id}
                    onChange={(e) =>
                      setIntegrations({ ...integrations, ghl_location_id: e.target.value })
                    }
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Button type="submit">Save keys</Button>
                  <Button type="button" variant="outline" onClick={testConnection} disabled={testing}>
                    <Plug className="size-4" />
                    {testing ? "Testing…" : "Test connection"}
                  </Button>
                </div>
                {testResult && <p className="text-sm text-muted-foreground">{testResult}</p>}
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Canned responses */}
        <TabsContent value="canned" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">New canned response</CardTitle>
              <CardDescription>
                Available in chat via <span className="font-mono">/canned</span>.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={createCanned} className="space-y-3">
                <div className="flex flex-wrap gap-3">
                  <div className="min-w-56 flex-1 space-y-1.5">
                    <Label htmlFor="canned-title">Title</Label>
                    <Input
                      id="canned-title"
                      required
                      value={newCanned.title}
                      onChange={(e) => setNewCanned({ ...newCanned, title: e.target.value })}
                      placeholder="Welcome message"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Department</Label>
                    <Select
                      value={newCanned.department_id || "none"}
                      onValueChange={(v) =>
                        setNewCanned({ ...newCanned, department_id: v === "none" ? "" : v })
                      }
                    >
                      <SelectTrigger className="w-44"><SelectValue placeholder="All" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">All departments</SelectItem>
                        {departments.map((d) => (
                          <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="canned-body">Body</Label>
                  <Textarea
                    id="canned-body"
                    rows={3}
                    required
                    value={newCanned.body}
                    onChange={(e) => setNewCanned({ ...newCanned, body: e.target.value })}
                    placeholder="Thanks for reaching out! We're looking into it…"
                  />
                </div>
                <Button type="submit" disabled={!newCanned.title.trim() || !newCanned.body.trim()}>
                  <Plus className="size-4" /> Add response
                </Button>
              </form>
            </CardContent>
          </Card>

          {canned.length === 0 ? (
            <EmptyState
              icon={Plus}
              title="No canned responses"
              description="Add reusable replies for your team above."
            />
          ) : (
            <ul className="space-y-2">
              {canned.map((item) => (
                <li
                  key={item.id}
                  className="flex items-start gap-3 rounded-lg border border-border p-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium">{item.title}</p>
                      <Badge variant="outline" className="text-[10px]">
                        {item.department_id
                          ? (deptNames[item.department_id] ?? "Department")
                          : "All departments"}
                      </Badge>
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{item.body}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => deleteCanned(item)}
                    aria-label={`Delete ${item.title}`}
                  >
                    <Trash2 className="size-4 text-muted-foreground" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        {/* Audit log */}
        <TabsContent value="audit" className="mt-4 space-y-4">
          <div className="relative w-80 max-w-full">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={auditQuery}
              onChange={(e) => setAuditQuery(e.target.value)}
              placeholder="Search action, entity, or user…"
              className="pl-8"
            />
          </div>
          {filteredAudit.length === 0 ? (
            <EmptyState
              icon={Search}
              title="No matching entries"
              description="Audit entries are recorded automatically as the team works."
            />
          ) : (
            <div className="rounded-xl border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Entity</TableHead>
                    <TableHead>When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAudit.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell>
                        <span className="flex items-center gap-2 text-sm">
                          <UserAvatar
                            name={entry.user?.full_name ?? "System"}
                            avatarUrl={entry.user?.avatar_url}
                            className="size-6"
                          />
                          {entry.user?.full_name ?? "System"}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm">
                        {entry.action.replaceAll("_", " ")}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {entry.entity_type}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDateTime(entry.created_at)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
