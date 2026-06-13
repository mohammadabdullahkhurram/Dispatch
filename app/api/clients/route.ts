import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { addDispatchTag, createGhlContact, searchContactByEmail, sendEmail } from "@/lib/ghl";
import { clientOnboardingEmail } from "@/lib/emails";
import { isTeamRole, type UserRole } from "@/lib/types";

/**
 * POST /api/clients — create a client (team only).
 * Body: { company_name, contact_name?, email, phone?, google_drive_folder_url? }
 *
 * Beyond the row insert (which triggers checklist templates + the
 * workspace thread), this creates the contact's portal account as
 * account_owner with a temporary password and sends the onboarding
 * email through GHL — the email path the dialog-only insert never had.
 */
export async function POST(request: NextRequest) {
  // First line in the handler — if this isn't in the logs, the request
  // never reached this route (stale deploy, wrong path, or server action).
  console.error("CLIENT CREATION STARTED", new Date().toISOString());

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: actor } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();
  if (!isTeamRole((actor?.role ?? null) as UserRole | null)) {
    return NextResponse.json(
      { error: "Only team members can create clients" },
      { status: 403 }
    );
  }

  const body = (await request.json().catch(() => null)) as {
    company_name?: string;
    contact_name?: string;
    email?: string;
    phone?: string;
    google_drive_folder_url?: string;
  } | null;

  const companyName = body?.company_name?.trim();
  const email = body?.email?.trim().toLowerCase();
  const phone = body?.phone?.trim() || null;

  if (!companyName || !email) {
    return NextResponse.json(
      { error: "Expected { company_name, email }" },
      { status: 400 }
    );
  }
  const contactName = body?.contact_name?.trim() || companyName;

  const admin = createAdminClient();
  // TEMP DEBUG — env visibility for the email path (booleans only, no secrets)
  console.log(
    `[clients][debug] env check: GHL_API_KEY=${!!process.env.GHL_API_KEY} GHL_LOCATION_ID=${!!process.env.GHL_LOCATION_ID} GHL_FROM_EMAIL=${!!process.env.GHL_FROM_EMAIL}`
  );
  console.log(`[clients] creating client "${companyName}" (owner: ${email})`);

  const { data: client, error: insertError } = await admin
    .from("clients")
    .insert({
      company_name: companyName,
      contact_name: contactName,
      email,
      phone,
      google_drive_folder_url: body?.google_drive_folder_url?.trim() || null,
      onboarding_status: "not_started",
    })
    .select("id, company_name")
    .single();

  if (insertError || !client) {
    console.error("[clients] insert failed:", insertError?.message);
    return NextResponse.json(
      {
        error:
          insertError?.code === "23505"
            ? "A client with this email already exists."
            : (insertError?.message ?? "Failed to create client."),
      },
      { status: insertError?.code === "23505" ? 409 : 500 }
    );
  }

  // The client-insert trigger creates the workspace thread, but until
  // migration 014's DDL is applied the trigger doesn't set chat_type,
  // so it inherits the 013 default of 'session'. Force the auto-created
  // workspace thread to the right type here so it shows in the
  // Workspace section and the portal can find it. Idempotent once 014
  // lands. See AUDIT.md Bug #1.
  const { error: fixTypeError } = await admin
    .from("chat_threads")
    .update({ chat_type: "workspace", is_deletable: false })
    .eq("client_id", client.id)
    .eq("category", "workspace")
    .neq("chat_type", "workspace");
  if (fixTypeError) {
    console.error("[clients] workspace chat_type fix failed:", fixTypeError.message);
  }

  // Portal account for the primary contact — reuse an existing login,
  // otherwise create one with a 12-char temporary password.
  let warning: string | null = null;
  let emailError: string | null = null;
  let userId: string | null = null;
  let tempPassword: string | null = null;

  const { data: existingUser } = await admin
    .from("users")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (existingUser) {
    userId = existingUser.id;
    console.log(`[clients] reusing existing account ${userId} for ${email}`);
  } else {
    tempPassword = randomBytes(9).toString("base64url"); // 12 chars
    console.log(`[clients][debug] Creating auth user for ${email}`);
    const { data: created, error: createError } =
      await admin.auth.admin.createUser({
        email,
        password: tempPassword,
        email_confirm: true,
        user_metadata: { full_name: contactName, role: "client" },
      });
    if (createError || !created.user) {
      console.error("[clients] auth user create failed:", createError?.message);
      warning = `Client created, but the portal account failed: ${createError?.message}`;
    } else {
      console.log(`[clients][debug] Auth user created: ${created.user.id}`);
      userId = created.user.id;
      await admin
        .from("users")
        .update({ full_name: contactName, phone })
        .eq("id", userId);
    }
  }

  if (userId) {
    const { error: linkError } = await admin
      .from("client_users")
      .insert({ client_id: client.id, user_id: userId, role: "account_owner" });
    // 23505 = already on the roster (reused account) — not a problem.
    if (linkError && linkError.code !== "23505") {
      console.error("[clients] roster link failed:", linkError.message);
      warning = `Client created, but the roster link failed: ${linkError.message}`;
    }

    // GHL contact + dispatch-user tag so their SMS reaches Dispatch.
    try {
      const contact =
        (await searchContactByEmail(email)) ??
        (await createGhlContact({ email, phone: phone ?? undefined, name: contactName }));
      if (contact) {
        await addDispatchTag(contact.id);
        await admin.from("users").update({ ghl_contact_id: contact.id }).eq("id", userId);
      }
    } catch (error) {
      console.error("[clients] GHL tagging failed:", error);
    }

    // Onboarding email: welcome + portal URL + login + support number.
    try {
      const { subject, html } = clientOnboardingEmail({
        email,
        fullName: contactName,
        companyName,
        tempPassword,
      });
      console.log(
        `[clients][debug] Calling sendEmail (to=${email}, tempPassword=${tempPassword ? "yes" : "no — existing account"})`
      );
      const sent = await sendEmail(email, subject, html, { contactName });
      console.log(`[clients][debug] sendEmail result: ${JSON.stringify(sent)}`);
      if (!sent.ok) {
        console.error("[clients][debug] sendEmail error:", sent.error);
        // Surface the real reason, don't swallow it — it travels back in
        // the API response (emailError) so it's visible in the Network
        // tab and Vercel logs.
        emailError = sent.error ?? "Unknown sendEmail failure";
        warning = warning ?? `Client created, but the onboarding email failed: ${sent.error}`;
      } else {
        console.log(`[clients] onboarding email sent to ${email}`);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown sendEmail exception";
      console.error("[clients] onboarding email threw:", message);
      emailError = message;
      warning = warning ?? "Client created, but the onboarding email failed.";
    }
  }

  await admin.from("audit_logs").insert({
    user_id: user.id,
    entity_type: "client",
    entity_id: client.id,
    action: "client_created",
    details: {
      company_name: client.company_name,
      owner_email: email,
      onboarding_email_sent: !warning,
    },
  });

  console.error(
    `CLIENT CREATION FINISHED ${client.id} — emailError=${emailError ?? "none"}`
  );
  return NextResponse.json({ client, warning, emailError });
}
