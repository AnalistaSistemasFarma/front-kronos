import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import {
  assertValentineWallAccess,
  parsePreferredCompanyId,
} from '@/lib/valentine/access';
import {
  subscribeValentineCompany,
  type ValentineRealtimeEvent,
} from '@/lib/valentine/realtime';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * SSE: empuja posts / reacciones / borrados del tablero de una empresa.
 * Heartbeat cada 20s para mantener viva la conexión.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const email = String(session?.user?.email || '')
    .trim()
    .toLowerCase();
  if (!email) {
    return new Response('Unauthorized', { status: 401 });
  }

  const preferred = parsePreferredCompanyId(
    req.nextUrl.searchParams.get('companyId')
  );
  const access = await assertValentineWallAccess(email, preferred);
  if (!access.ok || !access.company) {
    return new Response('Forbidden', { status: 403 });
  }

  const companyId = access.company.idCompany;
  const encoder = new TextEncoder();

  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let unsubscribe: (() => void) | null = null;
  let closed = false;
  let closeController: (() => void) | null = null;

  const cleanup = () => {
    if (closed) return;
    closed = true;
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
    closeController?.();
    closeController = null;
  };

  const stream = new ReadableStream({
    start(controller) {
      closeController = () => {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      const send = (payload: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(payload)}\n\n`)
          );
        } catch {
          cleanup();
        }
      };

      const onEvent = (event: ValentineRealtimeEvent) => {
        send(event);
      };

      unsubscribe = subscribeValentineCompany(companyId, onEvent);
      send({ type: 'connected', companyId });

      heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          cleanup();
        }
      }, 20000);

      req.signal.addEventListener('abort', cleanup);
    },
    cancel() {
      cleanup();
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
