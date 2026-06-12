"use client";

import { useMemo, useState } from "react";
import { ListChecks } from "lucide-react";
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
import {
  PriorityBadge,
  TaskStatusBadge,
  TASK_STATUS_LABELS,
} from "@/components/badges";
import { EmptyState } from "@/components/empty-state";
import { UserAvatar } from "@/components/user-avatar";
import { formatDate } from "@/lib/format";
import type { Task, TaskStatus } from "@/lib/types";

const ALL = "all";

/** Read-only task list for the client portal — no internal notes. */
export function PortalTasks({ initialTasks }: { initialTasks: Task[] }) {
  const [filterStatus, setFilterStatus] = useState(ALL);

  const tasks = useMemo(
    () =>
      filterStatus === ALL
        ? initialTasks
        : initialTasks.filter((t) => t.status === filterStatus),
    [initialTasks, filterStatus]
  );

  return (
    <div className="flex flex-1 flex-col gap-5 p-6 md:p-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Tasks</h1>
          <p className="text-sm text-muted-foreground">
            Work your Bluejaypro team is doing for you.
          </p>
        </div>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            {(Object.keys(TASK_STATUS_LABELS) as TaskStatus[]).map((s) => (
              <SelectItem key={s} value={s}>
                {TASK_STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </header>

      {tasks.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title="No tasks"
          description={
            filterStatus === ALL
              ? "Tasks your team creates for you will appear here."
              : "No tasks with this status."
          }
        />
      ) : (
        <div className="rounded-xl border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Due</TableHead>
                <TableHead>Team member</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tasks.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="max-w-80 truncate font-medium">
                    {t.title}
                  </TableCell>
                  <TableCell>
                    <TaskStatusBadge status={t.status} />
                  </TableCell>
                  <TableCell>
                    <PriorityBadge priority={t.priority} />
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {t.due_date ? formatDate(t.due_date) : "—"}
                  </TableCell>
                  <TableCell>
                    {t.assignee ? (
                      <span className="flex items-center gap-2 text-sm">
                        <UserAvatar
                          name={t.assignee.full_name}
                          avatarUrl={t.assignee.avatar_url}
                          className="size-6"
                        />
                        {t.assignee.full_name}
                      </span>
                    ) : (
                      <span className="text-sm text-muted-foreground">
                        Unassigned
                      </span>
                    )}
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
