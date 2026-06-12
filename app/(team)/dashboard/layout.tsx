import { Sidebar, type NavItem } from "@/components/sidebar";
import { NotificationBell } from "@/components/notification-bell";
import { ThemeToggle } from "@/components/theme-toggle";
import { getCurrentProfile } from "@/lib/data";
import { ROLE_LABELS } from "@/lib/types";

const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Overview", icon: "dashboard" },
  { href: "/dashboard/clients", label: "Clients", icon: "clients" },
  { href: "/dashboard/tickets", label: "Tickets", icon: "tickets" },
  { href: "/dashboard/tasks", label: "Tasks", icon: "tasks" },
  { href: "/dashboard/chat", label: "Chat", icon: "chat" },
  { href: "/dashboard/notifications", label: "Notifications", icon: "notifications" },
  { href: "/dashboard/settings", label: "Settings", icon: "settings" },
];

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { supabase, profile } = await getCurrentProfile();

  let unread = 0;
  if (profile) {
    const { count } = await supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", profile.id)
      .eq("read", false);
    unread = count ?? 0;
  }

  return (
    <div className="flex min-h-screen flex-1 flex-col bg-background md:flex-row">
      <Sidebar
        items={NAV_ITEMS}
        sectionLabel="Team workspace"
        profileHref="/dashboard/settings/profile"
        user={{
          name: profile?.full_name ?? "Team member",
          email: profile?.email ?? "",
          avatarUrl: profile?.avatar_url ?? null,
          roleLabel: profile ? ROLE_LABELS[profile.role] : undefined,
        }}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 hidden h-14 items-center justify-end gap-1 border-b border-border bg-background/80 px-6 backdrop-blur md:flex">
          <ThemeToggle />
          {profile && (
            <NotificationBell userId={profile.id} initialUnread={unread} />
          )}
        </header>
        <main className="flex min-w-0 flex-1 flex-col">{children}</main>
      </div>
    </div>
  );
}
