import { NextRequest, NextResponse } from 'next/server';
import { identificar } from '../../../../../../lib/portal/acceso';
import { formadoresDePortal } from '../../../../../../lib/portal/config';
import { normalizarImportacion } from '../../../../../../lib/portal/importar-forms';
import { SIN_CACHE, urlImportador } from '../../../../../../lib/portal/importar-forms-servidor';

const ID_TRABAJO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * FORMACIÓN — avance de una importación desde Microsoft Forms.
 *
 *   GET /api/portal/formularios/importar-forms/:id
 *     →  { estado: 'en_curso' | 'listo' | 'error', progreso: 0-100, etapa, resultado?, error? }
 *
 * Solo FORMADORES. Lo que devuelve el servicio es dato de un tercero: se NORMALIZA y acota
 * (`normalizarImportacion`) antes de enviarlo al navegador; nunca se reenvía en bruto.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ trabajoId: string }> }) {
  const quien = await identificar(request);
  if (!quien) return NextResponse.json({ error: 'Sesión no válida.' }, { status: 401 });
  if (!formadoresDePortal().includes(quien.correo.toLowerCase())) {
    return NextResponse.json({ error: 'Solo un formador puede importar formularios.' }, { status: 403 });
  }
  const id = (await params).trabajoId;
  if (!ID_TRABAJO.test(id)) return NextResponse.json({ error: 'Importación no válida.' }, { status: 400 });
  const base = urlImportador();
  if (!base) return NextResponse.json({ error: 'El importador de Microsoft Forms no está configurado en este ambiente.' }, { status: 503 });

  try {
    const res = await fetch(`${base}/importar/${id}`, { signal: AbortSignal.timeout(10_000), cache: 'no-store' });
    if (res.status === 404) return NextResponse.json({ error: 'La importación venció. Vuelva a intentarlo.' }, { status: 404, headers: SIN_CACHE });
    if (!res.ok) return NextResponse.json({ error: 'El importador de Microsoft Forms no respondió bien. Intente de nuevo.' }, { status: 502 });
    const s = (await res.json()) as { estado?: unknown; progreso?: unknown; etapa?: unknown; resultado?: unknown; error?: unknown };
    const estado = s.estado === 'listo' || s.estado === 'error' ? s.estado : 'en_curso';
    const progreso = typeof s.progreso === 'number' && Number.isFinite(s.progreso) ? Math.min(100, Math.max(0, Math.round(s.progreso))) : 0;
    const etapa = typeof s.etapa === 'string' ? s.etapa.slice(0, 120) : '';
    return NextResponse.json(
      {
        estado,
        progreso,
        etapa,
        ...(estado === 'listo' ? { resultado: normalizarImportacion(s.resultado) } : {}),
        ...(estado === 'error' ? { error: typeof s.error === 'string' ? s.error.slice(0, 400) : 'No se pudo importar el formulario.' } : {}),
      },
      { headers: SIN_CACHE }
    );
  } catch {
    return NextResponse.json({ error: 'El importador de Microsoft Forms no está disponible en este momento.' }, { status: 503 });
  }
}
