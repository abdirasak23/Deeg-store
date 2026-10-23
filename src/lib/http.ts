import { NextResponse } from "next/server";

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

export function fail(message: string, status = 400, code?: string) {
  return json({ error: message, ...(code ? { code } : {}) }, status);
}

export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const originHost = new URL(origin).host.toLowerCase();
    // Render terminates TLS at its proxy. The internal Next request URL can
    // therefore use http even though the browser is on the public https URL.
    // Compare the browser origin to the forwarded public host, then Host as a
    // fallback, while keeping the strict same-host check.
    const hosts = [request.headers.get("x-forwarded-host"), request.headers.get("host")]
      .flatMap((value) => (value ?? "").split(","))
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
    return hosts.includes(originHost);
  }
  catch { return false; }
}

export function dbError(error: { message?: string; code?: string } | null | undefined, fallback: string) {
  if (!error) return fail(fallback, 500);
  const code = error.code || "DATABASE_ERROR";
  const message = code === "42P01" ? "A required table is missing. Apply the store panel SQL migrations."
    : code === "42703" ? "The database is missing a column required by this panel. Apply the latest store panel SQL."
    : code === "42883" ? "A required database function is missing. Apply the latest store panel SQL."
    : fallback;
  return fail(message, 500, code);
}
