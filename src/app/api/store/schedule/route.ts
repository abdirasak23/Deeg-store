import { fail, json, sameOrigin } from "@/lib/http";
import { readStoreSession } from "@/lib/store-auth";
import { serviceDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await readStoreSession();
  if ("response" in session) return session.response;
  try {
    const db = serviceDb();
    const [{ data: store, error: storeError }, { data: hours, error: hoursError }] = await Promise.all([
      db.from("stores").select("id,name,is_open,timezone,manual_closed_until").eq("id", session.auth.store.id).single(),
      db.from("store_operating_hours").select("weekday,interval_no,opens_at,closes_at").eq("store_id", session.auth.store.id).order("weekday").order("interval_no"),
    ]);
    if (storeError) throw storeError;
    if (hoursError) throw hoursError;
    return json({ store, hours: hours ?? [] });
  } catch (error) {
    console.error("Store hours read failed:", (error as any)?.code ?? "unknown");
    return fail("Could not load store hours. Apply the store operating hours SQL migration.", 503, (error as any)?.code);
  }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return fail("Invalid request origin. Reload and try again.", 403, "BAD_ORIGIN");
  const session = await readStoreSession();
  if ("response" in session) return session.response;
  let body: any;
  try { body = await request.json(); } catch { return fail("Invalid store hours request.", 400, "INVALID_BODY"); }
  const db = serviceDb();
  try {
    if (body?.action === "set-open" && typeof body.is_open === "boolean") {
      const { data, error } = await db.rpc("store_set_manual_open", { p_store_id: session.auth.store.id, p_is_open: body.is_open });
      if (error) throw error;
      return json({ ok: true, is_open: body.is_open, manual_closed_until: data });
    }
    if (body?.action === "save-hours") {
      if (!Array.isArray(body.hours) || body.hours.length > 28) return fail("Add no more than four time windows per day.", 400, "INVALID_HOURS");
      const hours = body.hours.map((row: any, index: number) => ({
        weekday: row?.weekday, interval_no: row?.interval_no ?? (index % 4) + 1,
        opens_at: row?.opens_at, closes_at: row?.closes_at,
      }));
      for (const row of hours) {
        if (!Number.isInteger(row.weekday) || row.weekday < 0 || row.weekday > 6 ||
          !Number.isInteger(row.interval_no) || row.interval_no < 1 || row.interval_no > 4 ||
          !/^([01]\d|2[0-3]):[0-5]\d$/.test(row.opens_at) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(row.closes_at) || row.opens_at === row.closes_at)
          return fail("Check each opening and closing time.", 400, "INVALID_HOURS");
      }
      const timezone = typeof body.timezone === "string" ? body.timezone.trim() : "Africa/Nairobi";
      if (!timezone || timezone.length > 80) return fail("Enter a valid time zone, such as Africa/Nairobi.", 400, "INVALID_TIMEZONE");
      const { error } = await db.rpc("store_replace_operating_hours", { p_store_id: session.auth.store.id, p_hours: hours, p_timezone: timezone });
      if (error) throw error;
      return json({ ok: true });
    }
    return fail("Choose an opening-hours action.", 400, "INVALID_ACTION");
  } catch (error) {
    const code = (error as any)?.code;
    console.error("Store hours update failed:", code ?? "unknown");
    return fail(code === "42883" ? "Store hours SQL functions are missing. Apply the operating hours migration." : "Could not update store hours. Check the schedule and try again.", 503, code);
  }
}
