import { SettingsTabs } from "@/components/dashboard/settings-tabs";
import { getCurrentProfile } from "@/lib/data";
import type {
  AppSetting,
  AuditLog,
  CannedResponse,
  Department,
  UserProfile,
} from "@/lib/types";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const { supabase, profile } = await getCurrentProfile();

  const [settings, team, departments, canned, auditLogs] = await Promise.all([
    supabase.from("app_settings").select("*"),
    supabase.from("users").select("*").neq("role", "client").order("full_name"),
    supabase.from("departments").select("*").order("name"),
    supabase.from("canned_responses").select("*").order("title"),
    supabase
      .from("audit_logs")
      .select("*, user:users(id, full_name, avatar_url)")
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  return (
    <SettingsTabs
      currentUser={profile!}
      initialSettings={(settings.data ?? []) as AppSetting[]}
      initialTeam={(team.data ?? []) as UserProfile[]}
      initialDepartments={(departments.data ?? []) as Department[]}
      initialCanned={(canned.data ?? []) as CannedResponse[]}
      auditLogs={(auditLogs.data ?? []) as AuditLog[]}
      ghlStatus={{
        apiKey: !!process.env.GHL_API_KEY,
        locationId: !!process.env.GHL_LOCATION_ID,
        phoneNumber: !!process.env.GHL_PHONE_NUMBER,
        fromEmail: !!process.env.GHL_FROM_EMAIL,
      }}
    />
  );
}
