import { NextRequest, NextResponse } from 'next/server';
import { identificar } from '@/lib/portal/acceso';
import { leerBasePersonal } from '@/lib/portal/base-personal';
import { FormacionStorageError, FormacionStorageNoConfigurado } from '@/lib/portal/formacion-storage';
import { MODELO, personasPorNodo } from '@/lib/portal/organigrama';

/**
 * Personas de cada cargo del ORGANIGRAMA de Farmalógica (Cristian Baldión, 2026-10-15).
 *
 *   GET /api/portal/organigrama   →   { personas: { [idCuadro]: [{ empresa, nombre, area, cargo, correo }] }, total }
 *
 * Lee BASE PERSONAL (SharePoint, solo lectura) y devuelve SOLO las personas cuyo cargo corresponde a un cuadro del organigrama,
 * y de cada una solo esos cinco datos: la cédula y las demás columnas no se leen. Exige la misma identidad que el resto del
 * portal. No se guarda nada.
 */
export async function GET(request: NextRequest) {
  const quien = await identificar(request);
  if (!quien) return NextResponse.json({ error: 'Sesión no válida.' }, { status: 401 });

  try {
    const todas = await leerBasePersonal();
    const personas = personasPorNodo(MODELO.nodos, todas);
    const total = new Set(Object.values(personas).flat().map((p) => `${p.nombre}|${p.correo}|${p.empresa}`)).size;
    return NextResponse.json({ personas, total }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof FormacionStorageNoConfigurado) {
      console.error('[portal] Organigrama sin SharePoint configurado:', error.detalle);
      return NextResponse.json({ error: 'El organigrama no está configurado en este ambiente. Avise a Tecnología.' }, { status: 503 });
    }
    console.error('[portal] GET /api/portal/organigrama:', error instanceof FormacionStorageError ? error.message : (error as Error).name);
    const permiso = error instanceof FormacionStorageError && (error.status === 401 || error.status === 403);
    const faltaArchivo = error instanceof FormacionStorageError && error.status === 404;
    return NextResponse.json(
      {
        error: permiso
          ? 'El portal no tiene permiso para leer BASE PERSONAL en SharePoint. Avise a Tecnología.'
          : faltaArchivo
            ? 'No se encontró BASE PERSONAL en SharePoint. Avise a Tecnología.'
            : 'No se pudieron cargar los datos de las personas. Intente en un momento.',
      },
      { status: 502 }
    );
  }
}
