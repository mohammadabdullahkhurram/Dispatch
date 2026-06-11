import { NotificationsList } from "@/components/dashboard/notifications-list";
import { getCurrentProfile } from "@/lib/data";
import type { Notification } from "@/lib/types";

export const metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const { supabase, profile } = await getCurrentProfile();

  const { data: notifications } = await supabase
    .from("notifications")
    .select("*")
    .eq("user_id", profile!.id)
    .order("created_at", { ascending: false })
    .limit(100);

  return (
    <NotificationsList
      userId={profile!.id}
      initialNotifications={(notifications ?? []) as Notification[]}
    />
  );
}
