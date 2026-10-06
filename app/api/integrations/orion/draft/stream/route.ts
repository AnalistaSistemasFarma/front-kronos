import { NextRequest } from 'next/server';
import { withMssqlPool } from '@/lib/mssqlPool';
import { listDraftEventsSince, listDraftPresence, maxDraftEventId } from '@/lib/orion/draftBoardDb';
import { getOrionDraftInfo, syncOrionDraftClientReview } from '@/lib/orion/draftService';
import { getDraftSessionActor, readDraftTarget } from '@/lib/orion/draftRouteAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const POLL_MS = 1500;
const PRESENCE_EVERY = 2; // cada 2 vueltas (3 s)
const HEARTBEAT_MS = 20000;
const CLIENT_SYNC_EVERY = 14; // ~21 s

/**
 * SSE del tablero del documento. Producción corre en varios procesos (pm2 cluster), así que
 * los cambios se leen de orion_draft_event en vez de un canal en memoria.
 */
export async function GET(req: NextRequest) {
  const auth = await getDraftSessionActor();
  if (!auth) return new Response('Unauthorized', { status: 401 });
  const target = readDraftTarget(req.nextUrl.searchParams);
  if (!target) return new Response('Bad Request', { status: 400 });

  let lastId: number;
  try {
    const info = await withMssqlPool((pool) => getOrionDraftInfo(pool, { ...target, ...auth }));
    if (!info.permissions?.canViewBoard) return new Response('Forbidden', { status: 403 });
    lastId = await withMssqlPool((pool) => maxDraftEventId(pool, target.requestId, target.fileId));
  } catch {
    return new Response('Error', { status: 500 });
  }

  const encoder = new TextEncoder();
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const send = (payload: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        } catch {
          cleanup();
        }
      };
      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (timer) clearTimeout(timer);
        if (heartbeat) clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          /* ya cerrado */
        }
      };

      let tick = 0;
      const poll = async () => {
        if (closed) return;
        try {
          await withMssqlPool(async (pool) => {
            const events = await listDraftEventsSince(pool, target.requestId, target.fileId, lastId);
            for (const e of events) {
              lastId = Math.max(lastId, e.id);
              send({ type: e.type, payload: e.payload });
            }
            if (tick % PRESENCE_EVERY === 0) {
              send({ type: 'presence', presence: await listDraftPresence(pool, target.requestId, target.fileId) });
            }
            // Esperando al cliente: respaldo del webhook (la consulta a Orion se limita a cada 20 s).
            if (tick % CLIENT_SYNC_EVERY === 0) {
              await syncOrionDraftClientReview(pool, target);
            }
          });
        } catch {
          // Un fallo puntual de BD no corta la conexión; el navegador además recarga al volver.
        }
        tick++;
        if (!closed) timer = setTimeout(() => void poll(), POLL_MS);
      };

      send({ type: 'connected' });
      void poll();
      heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(': ping\n\n'));
        } catch {
          cleanup();
        }
      }, HEARTBEAT_MS);
      req.signal.addEventListener('abort', cleanup);
    },
    cancel() {
      closed = true;
      if (timer) clearTimeout(timer);
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
