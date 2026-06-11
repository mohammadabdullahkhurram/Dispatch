import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AccountSettings } from "@/components/account-settings";
import { getCurrentProfile } from "@/lib/data";

export const metadata = { title: "My Profile" };

export default async function TeamProfilePage() {
  const { profile } = await getCurrentProfile();
  if (!profile) return null;

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
          My Profile
        </h1>
        <p className="text-sm text-muted-foreground">
          Your personal details and password.
        </p>
      </div>

      <AccountSettings profile={profile} />
    </div>
  );
}
