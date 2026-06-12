"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Bell,
  Building2,
  FileText,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Menu,
  MessageSquare,
  Palette,
  Settings,
  Ticket,
  UserCircle,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { DispatchLogo } from "@/components/ui/dispatch-logo";
import { createClient } from "@/lib/supabase/client";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { UserAvatar } from "@/components/user-avatar";

// Icon names cross the server/client boundary as strings.
const ICONS = {
  dashboard: LayoutDashboard,
  clients: Building2,
  tickets: Ticket,
  tasks: ListChecks,
  chat: MessageSquare,
  notifications: Bell,
  settings: Settings,
  profile: UserCircle,
  checklist: ListChecks,
  documents: FileText,
  branding: Palette,
} satisfies Record<string, LucideIcon>;

export type NavItem = {
  href: string;
  label: string;
  icon: keyof typeof ICONS;
};

export type SidebarUser = {
  name: string;
  email: string;
  avatarUrl: string | null;
  roleLabel?: string;
};

function isActive(pathname: string, href: string) {
  const root = href === "/portal" || href === "/dashboard";
  if (root) return pathname === href;
  // Tab links like /portal/profile?tab=checklist compare on the path only.
  const [path] = href.split("?");
  return pathname === path || pathname.startsWith(`${path}/`);
}

function NavLinks({
  items,
  sectionLabel,
  pathname,
  onNavigate,
}: {
  items: NavItem[];
  sectionLabel: string;
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-3">
      <p className="section-label px-3 pb-2">{sectionLabel}</p>
      {items.map((item) => {
        const Icon = ICONS[item.icon];
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-3 rounded-md border-l-[3px] px-3 py-2 text-sm transition-colors",
              active
                ? "border-primary bg-primary/10 font-medium text-sidebar-foreground"
                : "border-transparent text-muted-foreground hover:bg-foreground/[0.04] hover:text-sidebar-foreground dark:hover:bg-white/[0.03]"
            )}
          >
            <Icon className={cn("size-4", active && "text-primary")} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

function Brand() {
  return (
    <div className="flex h-14 shrink-0 items-center border-b border-sidebar-border px-4">
      <Link href="/" aria-label="Dispatch home">
        <DispatchLogo variant="full" size="sm" />
      </Link>
    </div>
  );
}

function UserFooter({
  user,
  profileHref,
  onSignOut,
  onNavigate,
}: {
  user: SidebarUser;
  profileHref: string;
  onSignOut: () => void;
  onNavigate?: () => void;
}) {
  return (
    <div className="border-t border-sidebar-border p-3">
      <div className="flex items-center gap-1 rounded-md px-1 py-1">
        <Link
          href={profileHref}
          onClick={onNavigate}
          title="Profile settings"
          className="flex min-w-0 flex-1 items-center gap-3 rounded-md px-1 py-1 transition-colors hover:bg-sidebar-accent/60"
        >
          <UserAvatar name={user.name} avatarUrl={user.avatarUrl} className="size-8" />
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block truncate text-sm font-medium">{user.name}</span>
            {user.roleLabel ? (
              <Badge
                variant="outline"
                className="mt-0.5 h-4 border-primary/30 bg-primary/10 px-1.5 text-[10px] text-primary"
              >
                {user.roleLabel}
              </Badge>
            ) : (
              <span className="block truncate text-xs text-muted-foreground">
                {user.email}
              </span>
            )}
          </span>
        </Link>
        <button
          onClick={onSignOut}
          title="Sign out"
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
        >
          <LogOut className="size-4" />
        </button>
      </div>
    </div>
  );
}

export function Sidebar({
  items,
  sectionLabel,
  user,
  profileHref,
}: {
  items: NavItem[];
  sectionLabel: string;
  user: SidebarUser;
  profileHref: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);

  async function signOut() {
    await createClient().auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <>
      {/* Desktop */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex">
        <Brand />
        <NavLinks items={items} sectionLabel={sectionLabel} pathname={pathname} />
        <UserFooter user={user} profileHref={profileHref} onSignOut={signOut} />
      </aside>

      {/* Mobile top bar */}
      <div className="sticky top-0 z-40 flex items-center justify-between border-b border-sidebar-border bg-sidebar px-4 py-3 md:hidden">
        <DispatchLogo variant="full" size="sm" />
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger
            className="rounded-md p-2 text-muted-foreground hover:bg-sidebar-accent"
            aria-label="Open navigation"
          >
            <Menu className="size-5" />
          </SheetTrigger>
          <SheetContent side="left" className="flex w-72 flex-col gap-0 bg-sidebar p-0">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <Brand />
            <NavLinks
              items={items}
              sectionLabel={sectionLabel}
              pathname={pathname}
              onNavigate={() => setMobileOpen(false)}
            />
            <UserFooter
              user={user}
              profileHref={profileHref}
              onSignOut={signOut}
              onNavigate={() => setMobileOpen(false)}
            />
          </SheetContent>
        </Sheet>
      </div>
    </>
  );
}
