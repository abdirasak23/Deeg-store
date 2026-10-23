import { serviceDb } from "@/lib/db";
import { fail, json, sameOrigin } from "@/lib/http";
import { clearSessionCookie, readStoreSession } from "@/lib/store-auth";

export const runtime = "nodejs";
export async function POST(request: Request) {
  if (!sameOrigin(request)) return fail("Invalid request origin.", 403, "BAD_ORIGIN");
  const result = await readStoreSession();
  if (!("response" in result)) {
    try { await serviceDb().from("store_sessions").update({ revoked: true }).eq("id", result.auth.sessionId); }
    catch { /* Expiring the HttpOnly cookie still signs the browser out. */ }
  }
  return clearSessionCookie(json({ ok: true }));
}
