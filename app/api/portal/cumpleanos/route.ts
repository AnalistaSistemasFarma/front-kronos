import { NextRequest, NextResponse } from 'next/server';
import { identificar } from '@/lib/portal/acceso';
import { desdeIso, fechaValida } from '@/lib/portal/calendario';
import { cumpleanosEnRango, leerPersonasConCumple } from '@/lib/portal/cumpleanos';
import { FormacionStorageError, FormacionStorageNoConfigurado } from '@/lib/portal/formacion-storage';

/**
 * CUMPLEAÑOS del calendario del portal (Cristian Baldión, 2026-10-15).
 *
 *   GET /api/portal/cumpleanos?desde=AAAA-MM-DD&hasta=AAAA-MM-DD   (máx. 70 días, igual que los eventos)
 *     →  { cumpleanos: [{ fecha, personas: [{ nombre, empresa, area }] }] }
 *
 * Sale de BASE PERSONAL (SharePoint, solo lectura): la «Fecha de nacimiento» decide el día y el mes; se muestran «Apellidos y
 * Nombres», «Empresa contratante» y «Área / Dependencia». NO se devuelve el año de nacimiento, la edad ni la cédula. Los ve
 * cualquiera que entre al portal (misma identidad que los demás datos). Nunca se guarda en caché del navegador.
 */
const MAX_DIAS_RANGO = 70;
const SIN_CACHE = { 'Cache-Control': 'private, no-store' };

export async function GET(request: NextRequest) {
  const quien = await identificar(request);
  if (!quien) return NextResponse.json({ error: 'Sesión no válida.' }, { status: 401 });

  const desde = request.nextUrl.searchParams.get('desde');
  const hasta = request.nextUrl.searchParams.get('hasta');
  if (!fechaValida(desde) || !fechaValida(hasta) || hasta < desde) {
    return NextResponse.json({ error: 'El rango de fechas no es válido.' }, { status: 400 });
  }
  const dias = (desdeIso(hasta).getTime() - desdeIso(desde).getTime()) / 86_400_000;
  if (dias > MAX_DIAS_RANGO) return NextResponse.json({ error: `El rango admite máximo ${MAX_DIAS_RANGO} días.` }, { status: 400 });

  try {
    const personas = await leerPersonasConCumple();
    return NextResponse.json({ cumpleanos: cumpleanosEnRango(personas, desde, hasta) }, { headers: SIN_CACHE });
  } catch (error) {
    if (error instanceof FormacionStorageNoConfigurado) {
      console.error('[portal] Cumpleaños sin SharePoint configurado:', error.detalle);
      return NextResponse.json({ error: 'Los cumpleaños no están configurados en este ambiente.' }, { status: 503 });
    }
    console.error('[portal] GET /api/portal/cumpleanos:', error instanceof FormacionStorageError ? error.message : (error as Error).name);
    const permiso = error instanceof FormacionStorageError && (error.status === 401 || error.status === 403);
    const falta = error instanceof FormacionStorageError && error.status === 404;
    return NextResponse.json(
      {
        error: permiso
          ? 'El portal no tiene permiso para leer BASE PERSONAL en SharePoint. Avise a Tecnología.'
          : falta
            ? 'No se encontró BASE PERSONAL en SharePoint. Avise a Tecnología.'
            : 'No se pudieron cargar los cumpleaños. Intente en un momento.',
      },
      { status: 502 }
    );
  }
}
