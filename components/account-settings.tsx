"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UserAvatar } from "@/components/user-avatar";
import { createClient } from "@/lib/supabase/client";
import { logAudit } from "@/lib/audit";
import type { UserProfile } from "@/lib/types";

/**
 * Account settings shared by team (/dashboard/settings/profile) and
 * clients (/portal/profile → My Account): name, phone, avatar upload,
 * and password change. Email is display-only.
 */
export function AccountSettings({ profile }: { profile: UserProfile }) {
  const router = useRouter();
  const [info, setInfo] = useState({
    full_name: profile.full_name,
    phone: profile.phone ?? "",
  });
  const [avatarUrl, setAvatarUrl] = useState(profile.avatar_url);
  const [uploading, setUploading] = useState(false);
  const [savingInfo, setSavingInfo] = useState(false);
  const [infoMessage, setInfoMessage] = useState<{
    text: string;
    ok: boolean;
  } | null>(null);

  const [passwords, setPasswords] = useState({
    current: "",
    next: "",
    confirm: "",
  });
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<{
    text: string;
    ok: boolean;
  } | null>(null);

  async function uploadAvatar(file: File) {
    setUploading(true);
    setInfoMessage(null);
    const supabase = createClient();

    const ext = file.name.split(".").pop() ?? "png";
    const path = `avatars/${profile.id}/${Date.now()}.${ext}`;
    const { error: uploadError } = await supabase.storage
      .from("uploads")
      .upload(path, file, { upsert: true });

    if (uploadError) {
      setInfoMessage({ text: `Upload failed: ${uploadError.message}`, ok: false });
      setUploading(false);
      return;
    }

    const url = supabase.storage.from("uploads").getPublicUrl(path).data
      .publicUrl;
    const { error: updateError } = await supabase
      .from("users")
      .update({ avatar_url: url })
      .eq("id", profile.id);

    if (updateError) {
      setInfoMessage({ text: `Save failed: ${updateError.message}`, ok: false });
    } else {
      setAvatarUrl(url);
      setInfoMessage({ text: "Avatar updated.", ok: true });
      await logAudit(supabase, {
        userId: profile.id,
        entityType: "user",
        entityId: profile.id,
        action: "avatar_updated",
      });
      router.refresh(); // sidebar avatar picks up the change
    }
    setUploading(false);
  }

  async function saveInfo(e: React.FormEvent) {
    e.preventDefault();
    setSavingInfo(true);
    setInfoMessage(null);

    const supabase = createClient();
    const { error } = await supabase
      .from("users")
      .update({
        full_name: info.full_name.trim(),
        phone: info.phone.trim() || null,
      })
      .eq("id", profile.id);

    if (error) {
      setInfoMessage({ text: `Save failed: ${error.message}`, ok: false });
    } else {
      setInfoMessage({ text: "Profile saved.", ok: true });
      await logAudit(supabase, {
        userId: profile.id,
        entityType: "user",
        entityId: profile.id,
        action: "profile_updated",
        details: { full_name: info.full_name.trim() },
      });
      router.refresh();
    }
    setSavingInfo(false);
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setPasswordMessage(null);

    if (passwords.next.length < 8) {
      setPasswordMessage({
        text: "New password must be at least 8 characters.",
        ok: false,
      });
      return;
    }
    if (passwords.next !== passwords.confirm) {
      setPasswordMessage({ text: "New passwords don't match.", ok: false });
      return;
    }

    setSavingPassword(true);
    const supabase = createClient();

    // Verify the current password before allowing the change.
    const { error: verifyError } = await supabase.auth.signInWithPassword({
      email: profile.email,
      password: passwords.current,
    });
    if (verifyError) {
      setPasswordMessage({ text: "Current password is incorrect.", ok: false });
      setSavingPassword(false);
      return;
    }

    const { error: updateError } = await supabase.auth.updateUser({
      password: passwords.next,
    });
    if (updateError) {
      setPasswordMessage({ text: updateError.message, ok: false });
    } else {
      setPasswordMessage({ text: "Password changed.", ok: true });
      setPasswords({ current: "", next: "", confirm: "" });
      await logAudit(supabase, {
        userId: profile.id,
        entityType: "user",
        entityId: profile.id,
        action: "password_changed",
      });
    }
    setSavingPassword(false);
  }

  return (
    <div className="space-y-6">
      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle className="text-base">Profile</CardTitle>
          <CardDescription>How you appear across Dispatch.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={saveInfo} className="space-y-4">
            <div className="flex items-center gap-4">
              <UserAvatar
                name={info.full_name}
                avatarUrl={avatarUrl}
                className="size-16 text-lg"
              />
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
                <Upload className="size-4" />
                {uploading ? "Uploading…" : "Upload avatar"}
                <input
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) uploadAvatar(file);
                  }}
                />
              </label>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="acct-name">Full name</Label>
              <Input
                id="acct-name"
                required
                value={info.full_name}
                onChange={(e) => setInfo({ ...info, full_name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="acct-email">Email</Label>
              <Input id="acct-email" value={profile.email} disabled />
              <p className="text-xs text-muted-foreground">
                Email changes go through an administrator.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="acct-phone">Phone</Label>
              <Input
                id="acct-phone"
                value={info.phone}
                onChange={(e) => setInfo({ ...info, phone: e.target.value })}
                placeholder="+1 (555) 000-0000"
              />
            </div>

            {infoMessage && (
              <p
                className={
                  infoMessage.ok
                    ? "text-sm text-emerald-600 dark:text-emerald-400"
                    : "text-sm text-destructive"
                }
              >
                {infoMessage.text}
              </p>
            )}

            <Button type="submit" disabled={savingInfo || !info.full_name.trim()}>
              {savingInfo ? "Saving…" : "Save changes"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle className="text-base">Change password</CardTitle>
          <CardDescription>
            Enter your current password to set a new one.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={changePassword} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="pw-current">Current password</Label>
              <Input
                id="pw-current"
                type="password"
                required
                autoComplete="current-password"
                value={passwords.current}
                onChange={(e) =>
                  setPasswords({ ...passwords, current: e.target.value })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pw-next">New password</Label>
              <Input
                id="pw-next"
                type="password"
                required
                autoComplete="new-password"
                value={passwords.next}
                onChange={(e) =>
                  setPasswords({ ...passwords, next: e.target.value })
                }
                placeholder="At least 8 characters"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pw-confirm">Confirm new password</Label>
              <Input
                id="pw-confirm"
                type="password"
                required
                autoComplete="new-password"
                value={passwords.confirm}
                onChange={(e) =>
                  setPasswords({ ...passwords, confirm: e.target.value })
                }
              />
            </div>

            {passwordMessage && (
              <p
                className={
                  passwordMessage.ok
                    ? "text-sm text-emerald-600 dark:text-emerald-400"
                    : "text-sm text-destructive"
                }
              >
                {passwordMessage.text}
              </p>
            )}

            <Button
              type="submit"
              disabled={
                savingPassword ||
                !passwords.current ||
                !passwords.next ||
                !passwords.confirm
              }
            >
              {savingPassword ? "Updating…" : "Change password"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
