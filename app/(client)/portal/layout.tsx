import { Sidebar, type NavItem } from "@/components/sidebar";
import { getClientContext, getCurrentProfile } from "@/lib/data";
import { isClientAdminRole } from "@/lib/types";

// account_owner / account_admin see everything; office_member and
// contractor get tickets, tasks, and chat only.
const FULL_NAV: NavItem[] = [
  { href: "/portal", label: "Overview", icon: "dashboard" },
  { href: "/portal/tickets", label: "My Tickets", icon: "tickets" },
  { href: "/portal/chat", label: "Chat Support", icon: "chat" },
  { href: "/portal/profile?tab=checklist", label: "My Checklist", icon: "checklist" },
  { href: "/portal/profile?tab=documents", label: "Documents", icon: "documents" },
  { href: "/portal/profile?tab=branding", label: "Branding", icon: "branding" },
];

const LIMITED_NAV: NavItem[] = [
  { href: "/portal", label: "Overview", icon: "dashboard" },
  { href: "/portal/tickets", label: "My Tickets", icon: "tickets" },
  { href: "/portal/chat", label: "Chat Support", icon: "chat" },
];

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { supabase, profile } = await getCurrentProfile();

  let fullAccess = false;
  if (profile) {
    const { clientRole } = await getClientContext(supabase, profile);
    fullAccess = isClientAdminRole(clientRole);
  }

  return (
    <div className="flex min-h-screen flex-1 flex-col bg-background md:flex-row">
      <Sidebar
        items={fullAccess ? FULL_NAV : LIMITED_NAV}
        sectionLabel="Client portal"
        profileHref="/portal/profile?tab=account"
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
