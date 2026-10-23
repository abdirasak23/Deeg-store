import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { serviceDb } from "./db";
import { fail } from "./http";

export const STORE_COOKIE = "deeg_store_session";
export const SESSION_SECONDS = 7 * 24 * 60 * 60;
export type Store = { id: string; name: string; owner_name?: string; email: string; logo_url?: string | null; active: boolean; is_open?: boolean; prep_minutes?: number };
export type AuthStore = { store: Store; token: string; sessionId: string };

export async function createStoreSession(store: Store, request: Request) {
  const token = randomBytes(32).toString("base64url");
  const token_hash = createHash("sha256").update(token).digest("hex");
  const expires_at = new Date(Date.now() + SESSION_SECONDS * 1000).toISOString();
  const db = serviceDb();
  const { data, error } = await db.from("store_sessions").insert({ store_id: store.id, token_hash, expires_at, user_agent: request.headers.get("user-agent")?.slice(0, 512) ?? null }).select("id").single();
  if (error) throw error;
  const { error: loginError } = await db.from("stores").update({ last_login_at: new Date().toISOString() }).eq("id", store.id);
  if (loginError) {
    await db.from("store_sessions").update({ revoked: true }).eq("id", data.id);
    throw loginError;
  }
  return { token, sessionId: data.id };
}

export async function readStoreSession(): Promise<{ auth: AuthStore } | { response: ReturnType<typeof fail> }> {
  const token = (await cookies()).get(STORE_COOKIE)?.value ?? "";
  if (token.length < 32 || token.length > 256) return { response: fail("Your session ended. Sign in again.", 401, "SESSION_REQUIRED") };
  try {
    const token_hash = createHash("sha256").update(token).digest("hex");
    const db = serviceDb();
    const { data: session, error } = await db.from("store_sessions").select("id,store_id,expires_at,revoked")
      .eq("token_hash", token_hash).eq("revoked", false).gt("expires_at", new Date().toISOString()).maybeSingle();
    if (error) return { response: fail("Could not check the store session. Check that the store SQL migrations are applied.", 503, error.code) };
    if (!session) return { response: fail("Your session ended. Sign in again.", 401, "SESSION_EXPIRED") };
    const { data: store, error: storeError } = await db.from("stores")
      .select("id,name,owner_name,email,active,logo_url,is_open,prep_minutes").eq("id", session.store_id).eq("active", true).maybeSingle();
    if (storeError) return { response: fail("Could not load your store. Check the stores table migration.", 503, storeError.code) };
    if (!store) {
      await db.from("store_sessions").update({ revoked: true }).eq("id", session.id);
      return { response: fail("This store is inactive. Contact DEEG support.", 401, "STORE_INACTIVE") };
    }
    await db.from("store_sessions").update({ last_used_at: new Date().toISOString() }).eq("id", session.id);
    return { auth: { store, token, sessionId: session.id } };
  } catch {
    return { response: fail("The store session service is unavailable. Check the panel server settings.", 503, "SESSION_SERVICE_UNAVAILABLE") };
  }
}

export function setSessionCookie(response: import("next/server").NextResponse, token: string) {
  response.cookies.set(STORE_COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: SESSION_SECONDS });
  return response;
}

export function clearSessionCookie(response: import("next/server").NextResponse) {
  response.cookies.set(STORE_COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: 0 });
  return response;
}
