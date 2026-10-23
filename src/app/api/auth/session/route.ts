import { fail, json } from "@/lib/http";
import { readStoreSession } from "@/lib/store-auth";

export const dynamic = "force-dynamic";
export async function GET() {
  const result = await readStoreSession();
  if ("response" in result) return result.response;
  return json({ store: result.auth.store });
}
