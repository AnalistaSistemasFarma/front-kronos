import { NextRequest, NextResponse } from 'next/server';
import { identificar } from '../../../../../lib/portal/acceso';
import { formadoresDePortal } from '../../../../../lib/portal/config';
import { validarEnlaceForms } from '../../../../../lib/portal/importar-forms';
import { SIN_CACHE, urlImportador } from '../../../../../lib/portal/importar-forms-servidor';

/**
 * FORMACIÓN — IMPORTAR DESDE MICROSOFT FORMS (Cristian Baldión, 2026-10-09).
 *
 *   POST /api/portal/formularios/importar-forms   { url }  →  { id }
 *
 * Solo FORMADORES. Valida que el enlace sea de Microsoft Forms (https, sin credenciales) y arranca el
 * trabajo en el servicio `importador-forms` (loopback, `PORTAL_TH_IMPORTADOR_FORMS`). El avance se
 * consulta en `GET .../importar-forms/:id`. NO guarda nada en SynerLink: el resultado va al
 * constructor para que la persona lo revise y lo guarde.
 */
export async function POST(request: NextRequest) {
  const quien = await identificar(request);
  if (!quien) return NextResponse.json({ error: 'Sesión no válida.' }, { status: 401 });
  if (!formadoresDePortal().includes(quien.correo.toLowerCase())) {
    return NextResponse.json({ error: 'Solo un formador puede importar formularios.' }, { status: 403 });
  }
  const base = urlImportador();
  if (!base) return NextResponse.json({ error: 'El importador de Microsoft Forms no está configurado en este ambiente.' }, { status: 503 });

  let cuerpo: { url?: unknown } | null = null;
  try {
    cuerpo = JSON.parse(await request.text());
  } catch {
    cuerpo = null;
  }
  const enlace = validarEnlaceForms(cuerpo?.url);
  if (!enlace.ok) return NextResponse.json({ error: enlace.error }, { status: 400 });

  try {
    const res = await fetch(`${base}/importar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: enlace.url }),
      signal: AbortSignal.timeout(10_000),
      cache: 'no-store',
    });
    const data = (await res.json().catch(() => null)) as { id?: unknown; error?: unknown } | null;
    if (res.status === 202 && typeof data?.id === 'string') return NextResponse.json({ id: data.id }, { status: 202, headers: SIN_CACHE });
    if (res.status === 429) return NextResponse.json({ error: 'Hay otras importaciones en curso. Intente de nuevo en un momento.' }, { status: 429 });
    if (res.status === 400) return NextResponse.json({ error: 'El enlace no es válido.' }, { status: 400 });
    return NextResponse.json({ error: 'El importador de Microsoft Forms no respondió bien. Intente de nuevo.' }, { status: 502 });
  } catch {
    return NextResponse.json({ error: 'El importador de Microsoft Forms no está disponible en este momento.' }, { status: 503 });
  }
}
