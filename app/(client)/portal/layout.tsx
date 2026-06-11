import { Sidebar, type NavItem } from "@/components/sidebar";
import { getCurrentProfile } from "@/lib/data";

const NAV_ITEMS: NavItem[] = [
  { href: "/portal", label: "Overview", icon: "dashboard" },
  { href: "/portal/tickets", label: "My Tickets", icon: "tickets" },
  { href: "/portal/chat", label: "Chat Support", icon: "chat" },
  { href: "/portal/profile?tab=checklist", label: "My Checklist", icon: "checklist" },
  { href: "/portal/profile?tab=documents", label: "Documents", icon: "documents" },
  { href: "/portal/profile?tab=branding", label: "Branding", icon: "branding" },
];

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { profile } = await getCurrentProfile();

  return (
    <div className="flex min-h-screen flex-1 flex-col bg-background md:flex-row">
      <Sidebar
        items={NAV_ITEMS}
        sectionLabel="Client portal"
        user={{
          name: profile?.full_name ?? "Client",
          email: profile?.email ?? "",
          avatarUrl: profile?.avatar_url ?? null,
        }}
      />
      <main className="flex min-w-0 flex-1 flex-col">{children}</main>
    </div>
  );
}
