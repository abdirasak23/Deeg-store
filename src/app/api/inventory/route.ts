import { fail, json } from "@/lib/http";
import { readStoreSession } from "@/lib/store-auth";
import { serviceDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await readStoreSession();
  if ("response" in session) return session.response;
  try {
    const { data, error } = await serviceDb().from("store_product_availability")
      .select("product_id,stock_quantity,in_stock,updated_at,products(id,name,description,price,old_price,preparation_minutes,image_url,category_id,subcategories(name,categories(name)))")
      .eq("store_id", session.auth.store.id).order("updated_at", { ascending: false });
    if (error) {
      console.error("Inventory query failed:", error.code, error.message);
      const message = error.code === "42703"
        ? "Inventory quantity column is missing. Apply supabase/migrations/20261017000000_store_inventory.sql."
        : error.code === "42P01"
        ? "Inventory tables are missing. Apply the store panel SQL migrations."
        : "Could not load assigned products. Check the store product assignment schema.";
      return fail(message, 500, error.code);
    }
    const products = (data ?? []).flatMap((row: any) => {
      const product = Array.isArray(row.products) ? row.products[0] : row.products;
      if (!product) return [];
      const subcategory = Array.isArray(product.subcategories) ? product.subcategories[0] : product.subcategories;
      const category = Array.isArray(subcategory?.categories) ? subcategory.categories[0] : subcategory?.categories;
      return [{ id: product.id, name: product.name, description: product.description ?? "", price: Number(product.price ?? 0),
        old_price: product.old_price == null ? null : Number(product.old_price), preparation_minutes: Number(product.preparation_minutes ?? 20), image_url: product.image_url ?? null,
        category_id: product.category_id ?? null, category_name: category?.name ? `${category.name} / ${subcategory?.name}` : subcategory?.name ?? null,
        stock_quantity: Number(row.stock_quantity ?? 0), in_stock: Boolean(row.in_stock), updated_at: row.updated_at }];
    });
    return json({ products });
  } catch (error) {
    console.error("Inventory service failed:", error instanceof Error ? error.message : "unknown error");
    return fail("Inventory service is unavailable. Check the panel server database settings.", 503, "INVENTORY_SERVICE_ERROR");
  }
}
