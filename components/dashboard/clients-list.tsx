"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Building2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { OnboardingBadge } from "@/components/badges";
import { EmptyState } from "@/components/empty-state";
import { UserAvatar } from "@/components/user-avatar";
import { NewClientDialog } from "@/components/dashboard/new-client-dialog";
import type { Client, Department } from "@/lib/types";

export function ClientsList({
  clients,
  departments,
  openTicketCounts,
  currentUserId,
  canCreate,
}: {
  clients: Client[];
  departments: Department[];
  openTicketCounts: Record<string, number>;
  currentUserId: string | null;
  canCreate: boolean;
}) {
  const [query, setQuery] = useState("");
  const [showInactive, setShowInactive] = useState(false);

  const departmentNames = useMemo(
    () => Object.fromEntries(departments.map((d) => [d.id, d.name])),
    [departments]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return clients.filter(
      (c) =>
        (showInactive || c.status !== "inactive") &&
        (!q ||
          c.company_name.toLowerCase().includes(q) ||
          c.contact_name.toLowerCase().includes(q) ||
          c.email.toLowerCase().includes(q))
    );
  }, [clients, query, showInactive]);

  const inactiveCount = useMemo(
    () => clients.filter((c) => c.status === "inactive").length,
    [clients]
  );

  return (
    <div className="flex flex-1 flex-col gap-6 p-6 md:p-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Clients</h1>
          <p className="text-sm text-muted-foreground">
            {clients.length} client{clients.length === 1 ? "" : "s"} on the books.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Switch
              id="show-inactive"
              checked={showInactive}
              onCheckedChange={setShowInactive}
            />
            <Label
              htmlFor="show-inactive"
              className="text-sm font-normal text-muted-foreground"
            >
              Show inactive clients{inactiveCount ? ` (${inactiveCount})` : ""}
            </Label>
          </div>
          <div className="relative w-72 max-w-full">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search company, contact, email…"
              className="pl-8"
            />
          </div>
          {canCreate && currentUserId && (
            <NewClientDialog
              currentUserId={currentUserId}
              departments={departments}
            />
          )}
        </div>
      </header>

      {filtered.length === 0 ? (
        <EmptyState
          icon={Building2}
          title={query ? "No matches" : "No clients yet"}
          description={
            query
              ? `Nothing matched "${query}".`
              : "Clients will appear here once they're added."
          }
        />
      ) : (
        <div className="rounded-xl border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12" />
                <TableHead>Company</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Onboarding</TableHead>
                <TableHead className="text-center">Open tickets</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((client) => (
                <TableRow key={client.id}>
                  <TableCell>
                    <UserAvatar
                      name={client.company_name}
                      avatarUrl={client.logo_url}
                      className="size-8"
                    />
                  </TableCell>
                  <TableCell className="font-medium">
                    <span className="flex items-center gap-2">
                      <Link
                        href={`/dashboard/clients/${client.id}`}
                        className="hover:text-primary hover:underline"
                      >
                        {client.company_name}
                      </Link>
                      {client.status === "inactive" && (
                        <Badge
                          variant="outline"
                          className="border-red-500/30 bg-red-500/10 text-[10px] text-red-400"
                        >
                          Inactive
                        </Badge>
                      )}
                    </span>
                  </TableCell>
                  <TableCell>
                    <p className="text-sm">{client.contact_name}</p>
                    <p className="text-xs text-muted-foreground">{client.email}</p>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {client.assigned_department_id
                      ? (departmentNames[client.assigned_department_id] ?? "—")
                      : "Unassigned"}
                  </TableCell>
                  <TableCell>
                    <OnboardingBadge status={client.onboarding_status} />
                  </TableCell>
                  <TableCell className="text-center font-medium tabular-nums">
                    {openTicketCounts[client.id] ?? 0}
                  </TableCell>
                  <TableCell>
                    <Button asChild variant="ghost" size="sm">
                      <Link href={`/dashboard/clients/${client.id}`}>
                        View <ArrowRight className="size-3.5" />
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
