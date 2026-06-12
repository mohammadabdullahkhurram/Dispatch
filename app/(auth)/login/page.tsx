"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
import { isTeamRole, type UserRole } from "@/lib/types";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "forgot">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createClient();
    const { data, error: signInError } =
      await supabase.auth.signInWithPassword({ email, password });

    if (signInError || !data.user) {
      setError(signInError?.message ?? "Unable to sign in.");
      setLoading(false);
      return;
    }

    const { data: profile } = await supabase
      .from("users")
      .select("role")
      .eq("id", data.user.id)
      .single();

    const role = (profile?.role ?? "client") as UserRole;

    // Users of deactivated clients can't enter the portal.
    if (!isTeamRole(role)) {
      const { data: membership } = await supabase
        .from("client_users")
        .select("client:clients(status)")
        .eq("user_id", data.user.id)
        .limit(1)
        .maybeSingle();

      const rel = membership?.client as unknown;
      let clientStatus = (
        (Array.isArray(rel) ? rel[0] : rel) as { status?: string } | null
      )?.status;

      if (!clientStatus) {
        // Legacy email-linked primary contacts.
        const { data: legacyClient } = await supabase
          .from("clients")
          .select("status")
          .eq("email", email.trim().toLowerCase())
          .maybeSingle();
        clientStatus = legacyClient?.status;
      }

      if (clientStatus === "inactive") {
        await supabase.auth.signOut();
        setError(
          "Your account is currently inactive, contact your account manager."
        );
        setLoading(false);
        return;
      }
    }

    router.replace(isTeamRole(role) ? "/dashboard" : "/portal");
    router.refresh();
  }

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setLoading(true);

    const supabase = createClient();
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      email,
      { redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/reset-password` }
    );

    if (resetError) {
      setError(resetError.message);
    } else {
      setNotice("Check your email for a reset link.");
    }
    setLoading(false);
  }

  return (
    <main className="flex min-h-screen flex-1">
      {/* Left — brand panel */}
      <div className="relative hidden flex-1 flex-col justify-between bg-sidebar p-12 lg:flex">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <span className="flex size-7 items-center justify-center rounded-md bg-primary">
            <Zap className="size-4 text-primary-foreground" />
          </span>
          Internal Operations Platform
        </div>

        <div className="space-y-6">
          <h1 className="text-6xl font-bold tracking-tight text-primary">
            Dispatch
          </h1>
          <p className="max-w-md text-2xl font-medium leading-snug text-foreground">
            One platform. Every client. Zero chaos.
          </p>
        </div>

        <p className="text-sm text-muted-foreground/70">
          Bluejaypro · Digital Marketing Agency
        </p>

        {/* subtle accent glow */}
        <div
          aria-hidden
          className="pointer-events-none absolute -right-32 top-1/3 size-96 rounded-full bg-primary/10 blur-3xl"
        />
      </div>

      {/* Right — login / forgot password */}
      <div className="flex flex-1 items-center justify-center bg-background p-6">
        <div className="w-full max-w-sm space-y-6">
          <div className="space-y-1 text-center lg:hidden">
            <h1 className="text-3xl font-bold tracking-tight text-primary">
              Dispatch
            </h1>
            <p className="text-sm text-muted-foreground">
              One platform. Every client. Zero chaos.
            </p>
          </div>

          {mode === "login" ? (
            <Card>
              <CardHeader>
                <CardTitle>Welcome back</CardTitle>
                <CardDescription>
                  Sign in with your Dispatch account.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleLogin} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      required
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@bluejaypro.com"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="password">Password</Label>
                      <button
                        type="button"
                        onClick={() => {
                          setMode("forgot");
                          setError(null);
                          setNotice(null);
                        }}
                        className="text-xs text-primary hover:underline"
                      >
                        Forgot password?
                      </button>
                    </div>
                    <Input
                      id="password"
                      type="password"
                      required
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                    />
                  </div>

                  {error && (
                    <p className="text-sm text-destructive" role="alert">
                      {error}
                    </p>
                  )}

                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading ? "Signing in…" : "Sign in"}
                  </Button>
                </form>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>Reset your password</CardTitle>
                <CardDescription>
                  We&apos;ll email you a link to set a new one.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleForgot} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="forgot-email">Email</Label>
                    <Input
                      id="forgot-email"
                      type="email"
                      required
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@bluejaypro.com"
                    />
                  </div>

                  {error && (
                    <p className="text-sm text-destructive" role="alert">
                      {error}
                    </p>
                  )}
                  {notice && (
                    <p className="text-sm text-emerald-400" role="status">
                      {notice}
                    </p>
                  )}

                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading ? "Sending…" : "Send reset link"}
                  </Button>
                  <button
                    type="button"
                    onClick={() => {
                      setMode("login");
                      setError(null);
                      setNotice(null);
                    }}
                    className="w-full text-center text-sm text-muted-foreground hover:text-foreground"
                  >
                    Back to sign in
                  </button>
                </form>
              </CardContent>
            </Card>
          )}

          <p className="text-center text-xs text-muted-foreground">
            Access is provisioned by your Bluejaypro account manager.
          </p>
        </div>
      </div>
    </main>
  );
}
