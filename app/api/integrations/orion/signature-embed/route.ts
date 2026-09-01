import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../../auth/[...nextauth]/route';
import { getOrionConfig } from '@/lib/orion/config';
import { loadOrionUserSignature, saveOrionUserSignature } from '@/lib/orion/client';

/** GET — firma guardada del usuario en Orion. */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    const email = session?.user?.email?.trim();
    if (!email) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const cfg = getOrionConfig();
    if (!cfg.enabled) {
      return NextResponse.json({ error: 'Integración Orion no configurada' }, { status: 503 });
    }

    const result = await loadOrionUserSignature(email);
    if (!result.ok) {
      const errBody = result.data as { error?: string; code?: string } | null;
      const message =
        errBody?.error ||
        result.error ||
        'No se pudo cargar la firma desde GSS Firma';
      return NextResponse.json(
        { error: message, code: errBody?.code },
        { status: result.status >= 400 && result.status < 600 ? result.status : 502 }
      );
    }

    const dataUrl = result.data?.dataUrl ?? null;
    return NextResponse.json({
      success: true,
      hasSignature: Boolean(dataUrl),
      dataUrl,
      method: result.data?.method ?? null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error interno';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** POST — guardar firma del usuario en Orion (sin iframe). */
export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    const email = session?.user?.email?.trim();
    if (!email) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const cfg = getOrionConfig();
    if (!cfg.enabled) {
      return NextResponse.json({ error: 'Integración Orion no configurada' }, { status: 503 });
    }

    const body = await req.json().catch(() => ({}));
    const signatureDataUrl = String(body.signatureDataUrl ?? '').trim();
    const method = body.method === 'uploaded' ? 'uploaded' : 'drawn';

    if (!signatureDataUrl.startsWith('data:image/')) {
      return NextResponse.json({ error: 'Firma inválida' }, { status: 400 });
    }

    const result = await saveOrionUserSignature(email, signatureDataUrl, method);
    if (!result.ok) {
      const errBody = result.data as { error?: string; code?: string } | null;
      const message =
        errBody?.error ||
        result.error ||
        'No se pudo guardar la firma en GSS Firma';
      console.error('[signature-embed POST]', result.status, message);
      return NextResponse.json(
        { error: message, code: errBody?.code },
        { status: result.status >= 400 && result.status < 600 ? result.status : 502 }
      );
    }

    return NextResponse.json({ success: true, hasSignature: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error interno';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
