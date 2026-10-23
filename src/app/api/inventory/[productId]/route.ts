import { fail, json, sameOrigin } from "@/lib/http";
import { readStoreSession } from "@/lib/store-auth";
import { serviceDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ productId: string }> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request, context: Context) {
  if (!sameOrigin(request)) return fail("Invalid request origin. Reload and try again.", 403, "BAD_ORIGIN");
  const session = await readStoreSession();
  if ("response" in session) return session.response;
  const { productId } = await context.params;
  if (!UUID.test(productId)) return fail("Invalid product ID.", 400, "INVALID_PRODUCT_ID");
  let body: any;
  try { body = await request.json(); } catch { return fail("Invalid inventory update.", 400, "INVALID_BODY"); }
  let quantity: number | null = null;
  let inStock: boolean | null = null;
  if (body?.action === "set-quantity") {
    if (!Number.isSafeInteger(body.quantity) || body.quantity < 0 || body.quantity > 1_000_000_000)
      return fail("Stock must be a whole number between 0 and 1,000,000,000.", 400, "INVALID_STOCK_QUANTITY");
    quantity = body.quantity;
  } else if (body?.action === "set-availability") {
    if (typeof body.in_stock !== "boolean") return fail("Availability must be true or false.", 400, "INVALID_AVAILABILITY");
    inStock = body.in_stock;
  } else return fail("Choose a stock quantity or availability update.", 400, "INVALID_ACTION");
  try {
    const { data, error } = await serviceDb().rpc("store_update_inventory", {
      p_store_id: session.auth.store.id, p_product_id: productId,
      p_stock_quantity: quantity, p_in_stock: inStock,
    });
    if (error) {
      console.error("Inventory update failed:", error.code, error.message);
      if (error.code === "42883") return fail("Inventory update SQL is missing. Apply supabase/migrations/20261017000000_store_inventory.sql.", 503, error.code);
      if (error.code === "P0001") return fail(error.message || "This inventory update is not valid.", 400, error.code);
      return fail("Could not save this inventory change. Refresh and try again.", 500, error.code);
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return fail("This product is not assigned to your store.", 404, "PRODUCT_NOT_ASSIGNED");
    return json({ product_id: row.product_id, stock_quantity: row.stock_quantity, in_stock: row.in_stock, updated_at: row.updated_at });
  } catch (error) {
    console.error("Inventory update service failed:", error instanceof Error ? error.message : "unknown error");
    return fail("Inventory service is unavailable. Check the panel server database settings.", 503, "INVENTORY_SERVICE_ERROR");
  }
}
