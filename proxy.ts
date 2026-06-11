import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { isTeamRole, type UserRole } from "@/lib/types";

// Next.js 16: middleware.ts was renamed to proxy.ts (same behavior).
// Routes everyone by auth state + role: clients -> /portal, team -> /dashboard.

const PUBLIC_PATHS = ["/login", "/api/webhooks"];

function isPublic(pathname: string) {
  return PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );
}

export async function proxy(request: NextRequest) {
  const { response, supabase, user } = await updateSession(request);
  const { pathname } = request.nextUrl;

  // Preserve refreshed session cookies on redirects.
  const redirectTo = (path: string) => {
    const redirect = NextResponse.redirect(new URL(path, request.url));
    response.cookies
      .getAll()
      .forEach((cookie) => redirect.cookies.set(cookie));
    return redirect;
  };

  if (!user) {
    if (isPublic(pathname)) return response;
    return redirectTo("/login");
  }

  const { data: profile } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();

  const role = (profile?.role ?? null) as UserRole | null;
  const home = isTeamRole(role) ? "/dashboard" : "/portal";

  // Signed-in users don't belong on /login or the root splash.
  if (pathname === "/login" || pathname === "/") {
    return redirectTo(home);
  }

  // Keep each role inside its own area.
  if (pathname.startsWith("/portal") && isTeamRole(role)) {
    return redirectTo("/dashboard");
  }
  if (pathname.startsWith("/dashboard") && !isTeamRole(role)) {
    return redirectTo("/portal");
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Run on everything except static assets:
     * - _next/static, _next/image
     * - favicon.ico and common image/font files
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)",
  ],
};
