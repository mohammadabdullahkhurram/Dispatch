import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type {
  OnboardingStatus,
  Priority,
  TaskStatus,
  TicketCategory,
  TicketStatus,
} from "@/lib/types";

const CATEGORY_STYLES: Record<TicketCategory, string> = {
  seo: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  ghl: "bg-violet-500/15 text-violet-600 dark:text-violet-400 border-violet-500/30",
  software: "bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/30",
  billing: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
  general: "bg-slate-500/15 text-slate-600 dark:text-slate-400 border-slate-500/30",
};

const CATEGORY_LABELS: Record<TicketCategory, string> = {
  seo: "SEO",
  ghl: "GHL",
  software: "Software",
  billing: "Billing",
  general: "General",
};

export function CategoryBadge({ category }: { category: TicketCategory }) {
  return (
    <Badge variant="outline" className={cn("font-medium", CATEGORY_STYLES[category])}>
      {CATEGORY_LABELS[category]}
    </Badge>
  );
}

const PRIORITY_STYLES: Record<Priority, string> = {
  low: "bg-slate-500/15 text-slate-600 dark:text-slate-400 border-slate-500/30",
  medium: "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 border-yellow-500/30",
  high: "bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/30",
  urgent: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30",
};

export function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <Badge variant="outline" className={cn("font-medium capitalize", PRIORITY_STYLES[priority])}>
      {priority}
    </Badge>
  );
}

const TICKET_STATUS_STYLES: Record<TicketStatus, string> = {
  open: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30",
  in_progress: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
  escalated: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30",
  resolved: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
};

export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  open: "Open",
  in_progress: "In Progress",
  escalated: "Escalated",
  resolved: "Resolved",
};

export function TicketStatusBadge({ status }: { status: TicketStatus }) {
  return (
    <Badge variant="outline" className={cn("font-medium", TICKET_STATUS_STYLES[status])}>
      {TICKET_STATUS_LABELS[status]}
    </Badge>
  );
}

const TASK_STATUS_STYLES: Record<TaskStatus, string> = {
  todo: "bg-slate-500/15 text-slate-600 dark:text-slate-400 border-slate-500/30",
  in_progress: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
  done: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
};

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "To Do",
  in_progress: "In Progress",
  done: "Done",
};

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  return (
    <Badge variant="outline" className={cn("font-medium", TASK_STATUS_STYLES[status])}>
      {TASK_STATUS_LABELS[status]}
    </Badge>
  );
}

const ONBOARDING_STYLES: Record<OnboardingStatus, string> = {
  not_started: "bg-slate-500/15 text-slate-600 dark:text-slate-400 border-slate-500/30",
  in_progress: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
  completed: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
};

export const ONBOARDING_LABELS: Record<OnboardingStatus, string> = {
  not_started: "Not Started",
  in_progress: "In Progress",
  completed: "Completed",
};

export function OnboardingBadge({ status }: { status: OnboardingStatus }) {
  return (
    <Badge variant="outline" className={cn("font-medium", ONBOARDING_STYLES[status])}>
      {ONBOARDING_LABELS[status]}
    </Badge>
  );
}
