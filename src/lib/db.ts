import "server-only";
import { createClient } from "@supabase/supabase-js";
import { serverEnv } from "./server-env";

export function serviceDb() {
  const url = serverEnv("SUPABASE_URL") || serverEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key = serverEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Panel server is missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
