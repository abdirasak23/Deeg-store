import { serviceDb } from "@/lib/db";
import { readStoreSession } from "@/lib/store-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const session = await readStoreSession();
  if ("response" in session) return session.response;

  let db: ReturnType<typeof serviceDb>;
  try { db = serviceDb(); }
  catch { return Response.json({ error: "Order alert stream is not configured." }, { status: 503 }); }

  const storeId = session.auth.store.id;
  const encoder = new TextEncoder();
  let stopStream: (() => void) | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let stopped = false;
      let checkingSession = false;
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      let channel: ReturnType<typeof db.channel> | null = null;
      const send = (event: string, data: unknown) => {
        if (stopped) return;
        try { controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)); }
        catch { cleanup(); }
      };
      const cleanup = () => {
        if (stopped) return;
        stopped = true;
        if (heartbeat) clearInterval(heartbeat);
        request.signal.removeEventListener("abort", cleanup);
        if (channel) void db.removeChannel(channel);
        try { controller.close(); } catch { /* The browser already closed the stream. */ }
      };
      stopStream = cleanup;
      request.signal.addEventListener("abort", cleanup, { once: true });
      send("connected", { store_id: storeId });
      channel = db.channel(`store-order-alerts:${storeId}:${crypto.randomUUID()}`)
        .on("postgres_changes", {
          event: "*", schema: "public", table: "orders", filter: `store_id=eq.${storeId}`,
        }, () => send("orders", { changed: true }))
        .subscribe((status) => {
          if (status === "SUBSCRIBED") send("ready", { connected: true });
          else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") send("stream-error", { reconnecting: true });
        });
      heartbeat = setInterval(async () => {
        if (checkingSession || stopped) return;
        checkingSession = true;
        try {
          const { data, error } = await db.from("store_sessions").select("id")
            .eq("id", session.auth.sessionId).eq("revoked", false)
            .gt("expires_at", new Date().toISOString()).maybeSingle();
          if (error || !data) {
            send("auth-expired", { sign_in_again: true });
            cleanup();
            return;
          }
          send("ping", { at: Date.now() });
        } finally { checkingSession = false; }
      }, 25_000);
    },
    cancel() { stopStream?.(); },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
