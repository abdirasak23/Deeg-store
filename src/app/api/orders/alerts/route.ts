import { fail, json } from "@/lib/http";
import { readStoreSession } from "@/lib/store-auth";
import { serviceDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await readStoreSession();
  if ("response" in session) return session.response;
  try {
    const db = serviceDb();
    const { data: rows, error } = await db.from("orders")
      .select("id,order_no,status,created_at,updated_at,store_accepted_at,store_preparation_minutes,total,receiver_name")
      .eq("store_id", session.auth.store.id).in("status", ["placed", "confirmed"])
      .order("created_at", { ascending: true }).limit(200);
    if (error) {
      const code = error.code || "DATABASE_ERROR";
      const message = code === "42703"
        ? "Order alert timestamps are missing. Apply supabase/migrations/20261020000000_store_order_alerts.sql."
        : "Could not load pending and preparing order alerts.";
      return fail(message, 503, code);
    }
    if (!rows?.length) return json({ orders: [] });

    const preparing = rows.filter((row: any) => row.status === "confirmed" && !row.store_preparation_minutes);
    const itemOrderIds = preparing.map((row: any) => row.id);
    let minutesByOrder = new Map<string, number>();
    if (itemOrderIds.length) {
      const { data: items, error: itemError } = await db.from("order_items")
        .select("order_id,product_id").in("order_id", itemOrderIds);
      if (itemError) return fail("Could not calculate the preparation timer for an order.", 503, itemError.code);
      const productIds = [...new Set((items ?? []).map((item: any) => item.product_id).filter(Boolean))];
      if (productIds.length) {
        const { data: products, error: productError } = await db.from("products")
          .select("id,preparation_minutes").in("id", productIds);
        if (productError) return fail("Could not read product preparation times.", 503, productError.code);
        const byProduct = new Map((products ?? []).map((product: any) => [product.id, Number(product.preparation_minutes) || 20]));
        for (const item of items ?? []) {
          const duration = byProduct.get((item as any).product_id) ?? 20;
          minutesByOrder.set((item as any).order_id, Math.max(minutesByOrder.get((item as any).order_id) ?? 0, duration));
        }
      }
    }

    const alerts = rows.map((row: any) => {
      const status = row.status === "placed" ? "new" : "preparing";
      const acceptedAt = row.store_accepted_at ?? row.updated_at ?? row.created_at;
      const preparationMinutes = status === "preparing"
        ? Number(row.store_preparation_minutes) || minutesByOrder.get(row.id) || 20
        : null;
      const deadline = preparationMinutes == null ? null : new Date(Date.parse(acceptedAt) + preparationMinutes * 60_000).toISOString();
      return {
        id: row.id,
        order_number: String(row.order_no ?? row.id.slice(0, 8)),
        status,
        created_at: row.created_at,
        accepted_at: status === "preparing" ? acceptedAt : null,
        preparation_minutes: preparationMinutes,
        preparation_deadline_at: deadline,
        customer_name: typeof row.receiver_name === "string" ? row.receiver_name.trim().split(/\s+/)[0] || "Customer" : "Customer",
        total: Number(row.total ?? 0),
      };
    });
    return json({ orders: alerts });
  } catch (error) {
    console.error("Order alert query failed:", error instanceof Error ? error.message : "unknown error");
    return fail("Order alert service is unavailable. Check the panel database settings.", 503, "ORDER_ALERTS_UNAVAILABLE");
  }
}
