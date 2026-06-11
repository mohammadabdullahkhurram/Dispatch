"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Zap } from "lucide-react";
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
import { createClient } from "@/lib/supabase/client";

type Status = "verifying" | "ready" | "invalid" | "done";

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<Status>("verifying");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // The email link lands here with a recovery code (?code=...) or, on
  // older link formats, hash tokens the browser client picks up itself.
  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    async function verify() {
      const code = searchParams.get("code");
      if (code) {
        const { error: exchangeError } =
          await supabase.auth.exchangeCodeForSession(code);
        if (!cancelled) {
          setStatus(exchangeError ? "invalid" : "ready");
        }
        return;
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!cancelled) setStatus(session ? "ready" : "invalid");
    }

    verify();
    return () => {
      cancelled = true;
    };
  }, [searchParams]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }

    setSaving(true);
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({
      password,
    });

    if (updateError) {
      setError(updateError.message);
      setSaving(false);
      return;
    }

    setStatus("done");
    // The recovery session is signed in — the proxy routes "/" to the
    // right home for their role.
    setTimeout(() => {
      router.replace("/");
      router.refresh();
    }, 1500);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Set a new password</CardTitle>
        <CardDescription>
          {status === "verifying"
            ? "Verifying your reset link…"
            : status === "invalid"
              ? "This reset link is invalid or has expired."
              : status === "done"
                ? "Password updated — signing you in…"
                : "Choose a new password for your account."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {status === "ready" && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="new-password">New password</Label>
              <Input
                id="new-password"
                type="password"
                required
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm-password">Confirm new password</Label>
              <Input
                id="confirm-password"
                type="password"
                required
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="••••••••"
              />
            </div>

            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}

            <Button type="submit" className="w-full" disabled={saving}>
              {saving ? "Updating…" : "Update password"}
            </Button>
          </form>
        )}

        {status === "invalid" && (
          <Button asChild variant="outline" className="w-full">
            <Link href="/login">Request a new link</Link>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export default function ResetPasswordPage() {
  return (
    <main className="flex min-h-screen flex-1 items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="flex size-11 items-center justify-center rounded-xl bg-primary">
            <Zap className="size-5.5 text-primary-foreground" />
          </span>
          <h1 className="text-xl font-semibold tracking-tight">
            Dispatch password reset
          </h1>
        </div>
        <Suspense fallback={null}>
          <ResetPasswordForm />
        </Suspense>
      </div>
    </main>
  );
}
