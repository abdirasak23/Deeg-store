import { fail, json, sameOrigin } from "@/lib/http";
import { readStoreSession } from "@/lib/store-auth";
import { callStoreOrdersEdge } from "@/lib/store-orders-edge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  const session = await readStoreSession();
  if ("response" in session) return session.response;
  const { id } = await context.params;
  const result = await callStoreOrdersEdge(request, session.auth.token, { action: "get", order_id: id });
  return json(result.data, result.status);
}

export async function POST(request: Request, context: Context) {
  if (!sameOrigin(request)) return fail("Invalid request origin.", 403, "BAD_ORIGIN");
  const session = await readStoreSession();
  if ("response" in session) return session.response;
  const { id } = await context.params;
  let body: any;
  try { body = await request.json(); } catch { return fail("Choose an order action and try again.", 400, "INVALID_BODY"); }
  if (!body || typeof body.action !== "string") return fail("Choose accept, reject, or ready.", 400, "INVALID_ACTION");
  const result = await callStoreOrdersEdge(request, session.auth.token, { ...body, order_id: id });
  return json(result.data, result.status);
}
