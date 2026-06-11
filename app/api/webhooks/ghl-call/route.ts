import { NextResponse, type NextRequest } from "next/server";

/**
 * GoHighLevel call webhook (stub).
 * Will: verify the webhook signature, store the voice recording URL,
 * trigger transcription + AI summary, and create a phone-sourced ticket.
 */
export async function POST(request: NextRequest) {
  const payload = await request.json().catch(() => null);

  if (!payload) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // TODO: verify GHL signature, resolve client by phone number,
  // create a tickets row (source: 'phone') via the service-role client.
  console.log("[webhook] ghl-call received", payload);

  return NextResponse.json({ received: true });
}
