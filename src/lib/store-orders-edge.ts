import "server-only";
import { createHash, createHmac } from "node:crypto";
import { isIP } from "node:net";
import { serverEnv } from "./server-env";

type OrderAction = Record<string, unknown>;

export async function callStoreOrdersEdge(request: Request, sessionToken: string, body: OrderAction) {
  const supabaseUrl = serverEnv("SUPABASE_URL") || serverEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = serverEnv("SUPABASE_ANON_KEY") || serverEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const proxySecret = serverEnv("STORE_PROXY_SECRET");
  if (!supabaseUrl || !anonKey || proxySecret.length < 32) {
    return {
      status: 503,
      data: { error: "Order Edge Function is not configured. Set the Supabase URL, anon key, and STORE_PROXY_SECRET on the Store Panel server." },
    };
  }

  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const requestOrigin = forwardedHost && forwardedProto
    ? `${forwardedProto}://${forwardedHost}`
    : new URL(request.url).origin;
  const configuredOrigins = serverEnv("STORE_PANEL_ORIGIN").split(",").map((value) => value.trim()).filter(Boolean);
  const origins = [...new Set([requestOrigin, ...configuredOrigins])];
  const ipCandidates = [request.headers.get("x-real-ip"), request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()];
  const clientIp = ipCandidates.find((candidate): candidate is string => !!candidate && isIP(candidate) !== 0) ?? "127.0.0.1";
  const serializedBody = JSON.stringify(body);
  const bodyHash = createHash("sha256").update(serializedBody).digest("hex");
  const sessionHash = createHash("sha256").update(sessionToken).digest("hex");

  try {
    let lastOriginBlocked = false;
    for (const origin of origins) {
      const timestamp = String(Date.now());
      // `x-deeg-proxy-signature` remains compatible with the already-deployed
      // function. V2 additionally binds the exact body and session digest.
      const legacySignature = createHmac("sha256", proxySecret)
        .update(`POST\nstore-orders\n${timestamp}\n${origin}\n${clientIp}`)
        .digest("hex");
      const signatureV2 = createHmac("sha256", proxySecret)
        .update(`POST\nstore-orders\n${timestamp}\n${origin}\n${clientIp}\n${bodyHash}\n${sessionHash}`)
        .digest("hex");
      const response = await fetch(`${supabaseUrl.replace(/\/$/, "")}/functions/v1/store-orders`, {
        method: "POST",
        headers: {
          apikey: anonKey,
          authorization: `Bearer ${anonKey}`,
          "content-type": "application/json",
          origin,
          "x-deeg-store-session": sessionToken,
          "x-deeg-proxy-timestamp": timestamp,
          "x-deeg-proxy-signature": legacySignature,
          "x-deeg-proxy-signature-v2": signatureV2,
          "x-deeg-client-ip": clientIp,
        },
        body: serializedBody,
        cache: "no-store",
      });
      const responseText = await response.text();
      let data: any;
      try { data = responseText ? JSON.parse(responseText) : {}; }
      catch { data = { error: responseText || "The store-orders function returned an unreadable response." }; }
      if (response.status === 403 && /forbidden origin/i.test(String(data?.error ?? ""))) {
        lastOriginBlocked = true;
        continue;
      }
      if (response.status === 404) {
        return { status: 503, data: { error: "The store-orders Edge Function is not deployed to the configured Supabase project." } };
      }
      if (Array.isArray(data?.orders)) {
        data.orders = data.orders.map((order: any) => ({
          ...order,
          customer_name: order.customer_name ?? order.customer_first_name ?? "Customer",
        }));
      }
      if (data?.order && typeof data.order === "object") {
        data.order = {
          ...data.order,
          customer_name: data.order.customer_name ?? data.order.customer_first_name ?? "Customer",
        };
      }
      return { status: response.status, data };
    }
    if (lastOriginBlocked) {
      return { status: 503, data: { error: `Supabase rejected the Store Panel origin. Add one of these exact origins to the store-orders function's STORE_PANEL_ORIGIN secret: ${origins.join(", ")}.` } };
    }
    return { status: 502, data: { error: "Could not reach the store-orders Edge Function." } };
  } catch {
    return { status: 502, data: { error: "Could not reach the store-orders Edge Function. Check the Supabase URL and network." } };
  }
}
