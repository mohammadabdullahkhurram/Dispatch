/**
 * Wipes test data via the Supabase service-role client, then verifies
 * row counts. Preserves users, departments, checklist_templates,
 * canned_responses, app_settings.
 *
 * Usage: node --env-file=.env.local scripts/run-reset.mjs
 * Requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in the environment."
  );
  process.exit(1);
}

const db = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// PostgREST deletes need a filter; this matches every real uuid.
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

// FK-safe order. Note: there is no call_logs table — call records are
// chat_messages rows (message_type 'call_log') and go with them.
const WIPE = [
  "task_comments",
  "chat_messages",
  "chat_threads",
  "notifications",
  "audit_logs",
  "ticket_activity_log",
  "tickets",
  "tasks",
  "client_documents",
  "client_checklist_items",
  "client_users",
  "clients",
];

const PRESERVE = [
  "users",
  "departments",
  "checklist_templates",
  "canned_responses",
  "app_settings",
];

console.log("— Deleting test data —");
for (const table of WIPE) {
  const { error } = await db.from(table).delete().neq("id", NIL_UUID);
  console.log(error ? `✗ ${table}: ${error.message}` : `✓ wiped ${table}`);
}

console.log("\n— Verification (row counts) —");
for (const table of [...WIPE, ...PRESERVE]) {
  const { count, error } = await db
    .from(table)
    .select("id", { count: "exact", head: true });
  const label = PRESERVE.includes(table) ? "(preserved)" : "(wiped)";
  console.log(
    error
      ? `✗ ${table}: ${error.message}`
      : `${table} ${label}: ${count} rows`
  );
}

console.log("\n— Users intact —");
const { data: users, error: usersError } = await db
  .from("users")
  .select("email, role")
  .order("email");
if (usersError) {
  console.error(`✗ users: ${usersError.message}`);
} else {
  for (const u of users) console.log(`  ${u.email} (${u.role})`);
  console.log(`Total: ${users.length} users`);
}
