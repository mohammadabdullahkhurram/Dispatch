import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/cron/notifications — runs the time-based notification
 * checks (SLA breach, task due soon, task overdue). Scheduled via
 * vercel.json; results are deduped in the DB so re-runs are safe.
 * If CRON_SECRET is set, requests must carry it as a Bearer token
 * (Vercel Cron does this automatically).
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { error } = await admin.rpc("run_time_based_notifications");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
