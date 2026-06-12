import Link from "next/link";
import { ArrowLeft, ShieldAlert } from "lucide-react";
import { ChecklistTemplates } from "@/components/dashboard/checklist-templates";
import { EmptyState } from "@/components/empty-state";
import { getCurrentProfile } from "@/lib/data";
import { isAgencyManagerRole, type ChecklistTemplate, type Client } from "@/lib/types";

export const metadata = { title: "Checklist Templates" };

export default async function ChecklistTemplatesPage() {
  const { supabase, profile } = await getCurrentProfile();

  if (!profile || !isAgencyManagerRole(profile.role)) {
    return (
      <div className="flex flex-1 flex-col p-6 md:p-8">
        <EmptyState
          icon={ShieldAlert}
          title="Managers only"
          description="Checklist templates can be managed by agency owners, admins, and managers."
        />
      </div>
    );
  }

  const [templates, clients] = await Promise.all([
    supabase
      .from("checklist_templates")
      .select("*")
      .order("created_at", { ascending: true }),
    supabase.from("clients").select("id, company_name").order("company_name"),
  ]);

  return (
    <div className="flex flex-1 flex-col gap-6 p-6 md:p-8">
      <div>
        <Link
          href="/dashboard/settings"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Settings
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          Checklist Templates
        </h1>
        <p className="text-sm text-muted-foreground">
          The onboarding checklist every new client receives automatically.
          Apply items to existing clients from here.
        </p>
      </div>

      <ChecklistTemplates
        currentUserId={profile.id}
        initialTemplates={(templates.data ?? []) as ChecklistTemplate[]}
        clients={(clients.data ?? []) as Pick<Client, "id" | "company_name">[]}
      />
    </div>
  );
}
