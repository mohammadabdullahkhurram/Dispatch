import { NextResponse, type NextRequest } from "next/server";

/**
 * GoHighLevel inbound SMS webhook (stub).
 * Will: verify the webhook signature, match the sender to a client,
 * and append the message to their chat thread / open a ticket.
 */
export async function POST(request: NextRequest) {
  const payload = await request.json().catch(() => null);

  if (!payload) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // TODO: verify GHL signature, resolve client by phone number,
  // insert chat_messages row via the service-role client.
  console.log("[webhook] ghl-sms received", payload);

  return NextResponse.json({ received: true });
}
