import { room } from "@/lib/game-server";
import { DIRECTIONS, type Direction } from "@/lib/maze";

export async function GET(request: Request) {
  const encoder = new TextEncoder();
  const player = room.addPlayer();
  let disconnect = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let unsubscribe = () => {};
      const close = () => {
        if (closed) return;
        closed = true;
        unsubscribe();
        request.signal.removeEventListener("abort", close);
        try { controller.close(); } catch { /* Already cancelled by the browser. */ }
      };
      disconnect = close;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        // Drop a stalled connection rather than accumulating snapshots in memory.
        if ((controller.desiredSize ?? 0) < -10) { close(); return; }
        try { controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)); }
        catch { close(); }
      };
      send("welcome", { id: player.id });
      unsubscribe = room.subscribe(player.id, (event) => send(event.type, event.data));
      request.signal.addEventListener("abort", close, { once: true });
      if (request.signal.aborted) close();
    },
    cancel() { disconnect(); },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-store, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin) {
    // Next may build request.url from its internal listening hostname. The Host
    // header preserves the public address, including behind a reverse proxy.
    let originHost: string;
    try { originHost = new URL(origin).host; }
    catch { return Response.json({ error: "Invalid origin." }, { status: 403 }); }
    if (originHost !== request.headers.get("host")) {
      return Response.json({ error: "Use the game on this site." }, { status: 403 });
    }
  }
  let body: unknown;
  try { body = await request.json(); }
  catch { return Response.json({ error: "Invalid JSON." }, { status: 400 }); }
  if (!body || typeof body !== "object" || !("id" in body) || !("direction" in body)
      || typeof body.id !== "string" || typeof body.direction !== "string"
      || (body.direction !== "stop" && !Object.hasOwn(DIRECTIONS, body.direction))) {
    return Response.json({ error: "Invalid movement." }, { status: 400 });
  }
  const sequence = "sequence" in body ? body.sequence : 0;
  if (typeof sequence !== "number" || !Number.isSafeInteger(sequence) || sequence < 0) {
    return Response.json({ error: "Invalid command sequence." }, { status: 400 });
  }
  if (!room.input(body.id, body.direction as Direction | "stop", sequence)) {
    return Response.json({ error: "Reconnect to join the maze." }, { status: 404 });
  }
  return new Response(null, { status: 204 });
}
