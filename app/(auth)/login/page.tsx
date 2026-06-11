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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
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
    router.replace(isTeamRole(role) ? "/dashboard" : "/portal");
    router.refresh();
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

      {/* Right — login form */}
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

          <Card>
            <CardHeader>
              <CardTitle>Welcome back</CardTitle>
              <CardDescription>
                Sign in with your Dispatch account.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
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
                  <Label htmlFor="password">Password</Label>
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

          <p className="text-center text-xs text-muted-foreground">
            Access is provisioned by your Bluejaypro account manager.
          </p>
        </div>
      </div>
    </main>
  );
}
