import { fail, json } from "@/lib/http";
import { readStoreSession } from "@/lib/store-auth";
import { serviceDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STORE_TIME_ZONE = "Africa/Nairobi";
function storeDateKey(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: STORE_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find(part => part.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
function shiftDateKey(key: string, days: number) {
  const date = new Date(`${key}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export async function GET() {
  const session = await readStoreSession();
  if ("response" in session) return session.response;
  try {
    const db = serviceDb();
    const storeId = session.auth.store.id;
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [ordersResult, inventoryResult] = await Promise.all([
      db.from("orders").select("id,status,created_at,total").eq("store_id", storeId).gte("created_at", since.toISOString()).order("created_at", { ascending: true }).limit(5000),
      db.from("store_product_availability").select("product_id,stock_quantity,in_stock").eq("store_id", storeId),
    ]);
    if (ordersResult.error) {
      console.error("Dashboard orders query failed:", ordersResult.error.code, ordersResult.error.message);
      return fail(ordersResult.error.code === "42703" ? "Orders table is missing fields required for dashboard analytics." : "Could not load order analytics.", 500, ordersResult.error.code);
    }
    if (inventoryResult.error) {
      console.error("Dashboard inventory query failed:", inventoryResult.error.code, inventoryResult.error.message);
      return fail(inventoryResult.error.code === "42703" ? "Inventory quantity is missing. Apply the inventory migration." : "Could not load inventory analytics.", 500, inventoryResult.error.code);
    }
    const today = storeDateKey(new Date());
    const daily = Array.from({ length: 7 }, (_, i) => ({ date: shiftDateKey(today, i - 6), orders: 0, revenue: 0 }));
    const byDate = new Map(daily.map(row => [row.date, row]));
    const orderStatus: Record<string, number> = { placed: 0, confirmed: 0, packed: 0, assigned: 0, on_the_way: 0, delivered: 0, cancelled: 0 };
    let revenue30d = 0;
    for (const order of ordersResult.data ?? []) {
      const key = storeDateKey(new Date(order.created_at));
      const day = byDate.get(key);
      if (day) day.orders += 1;
      if (order.status in orderStatus) orderStatus[order.status] += 1;
      if (order.status !== "cancelled") {
        const value = Number(order.total ?? 0);
        revenue30d += value;
        if (day) day.revenue += value;
      }
    }
    const inventory = inventoryResult.data ?? [];
    const stockUnits = inventory.reduce((sum, row) => sum + Number(row.stock_quantity ?? 0), 0);
    const available = inventory.filter(row => row.in_stock && Number(row.stock_quantity ?? 0) > 0).length;
    const outOfStock = inventory.filter(row => !row.in_stock || Number(row.stock_quantity ?? 0) === 0).length;
    return json({
      totals: { orders_30d: (ordersResult.data ?? []).length, revenue_30d: revenue30d, assigned_products: inventory.length,
        available_products: available, out_of_stock_products: outOfStock, stock_units: stockUnits },
      daily, order_status: orderStatus,
    });
  } catch (error) {
    console.error("Dashboard service failed:", error instanceof Error ? error.message : "unknown error");
    return fail("Dashboard is unavailable. Check the panel server database settings.", 503, "DASHBOARD_SERVICE_ERROR");
  }
}
