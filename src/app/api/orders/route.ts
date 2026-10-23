import { fail, json } from "@/lib/http";
import { readStoreSession } from "@/lib/store-auth";
import { callStoreOrdersEdge } from "@/lib/store-orders-edge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const allowed: Record<string, string[]> = { new: ["placed"], preparing: ["confirmed"], ready: ["packed", "assigned", "on_the_way"], completed: ["delivered"], cancelled: ["cancelled"] };

export async function GET(request: Request) {
  const session = await readStoreSession();
  if ("response" in session) return session.response;
  const url = new URL(request.url);
  const status = url.searchParams.get("status") || "new";
  if (!allowed[status]) return fail("Unknown order status.", 400, "BAD_STATUS");
  const result = await callStoreOrdersEdge(request, session.auth.token, { action: "list", status, limit: 100 });
  return json(result.data, result.status);
}
