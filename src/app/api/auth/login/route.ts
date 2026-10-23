import { compare } from "bcryptjs";
import { isIP } from "node:net";
import { NextResponse } from "next/server";
import { serviceDb } from "@/lib/db";
import { dbError, fail, json, sameOrigin } from "@/lib/http";
import { createStoreSession, setSessionCookie } from "@/lib/store-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
  if (!sameOrigin(request)) return fail("Invalid request origin. Reload the panel and try again.", 403, "BAD_ORIGIN");
  let body: any;
  try { body = await request.json(); } catch { return fail("Enter your store email and phone number.", 400, "INVALID_BODY"); }
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password.trim() : "";
  const phoneDigits = password.replace(/\D/g, "");
  if (!EMAIL.test(email) || email.length > 254 || phoneDigits.length < 7 || phoneDigits.length > 18)
    return fail("Enter the registered store email and phone number.", 400, "INVALID_CREDENTIALS_FORMAT");
  try {
    const db = serviceDb();
    const forwarded = request.headers.get("x-real-ip")?.trim() || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "";
    const ip = isIP(forwarded) ? forwarded : "127.0.0.1";
    const { data: allowed, error: limitError } = await db.rpc("consume_store_login_attempt", { p_email: email, p_ip: ip });
    if (limitError) return dbError(limitError, "Store login rate limiting is unavailable. Apply the store authentication migration.");
    if (allowed !== true) return fail("Too many sign-in attempts. Wait a minute and try again.", 429, "RATE_LIMITED");

    const { data: store, error } = await db.from("stores")
      .select("id,name,owner_name,email,phone,password_hash,active,logo_url,is_open,prep_minutes")
      .eq("email", email).eq("active", true).maybeSingle();
    if (error) return dbError(error, "Could not check the store account. Apply the store phone-password migration.");
    let valid = false;
    if (store?.password_hash) {
      try { valid = await compare(phoneDigits, store.password_hash); } catch { valid = false; }
    }
    if (!store || !valid) return fail("Email or phone number is incorrect.", 401, "INVALID_CREDENTIALS");

    const { token } = await createStoreSession(store, request);
    const response = json({ store: { id: store.id, name: store.name, email: store.email, logo_url: store.logo_url } });
    return setSessionCookie(response, token);
  } catch (error) {
    console.error("Store login failed:", error instanceof Error ? error.message : "unknown error");
    return fail("Store login could not finish. Check the server database connection and store SQL migrations.", 503, "LOGIN_SERVICE_ERROR");
  }
}
