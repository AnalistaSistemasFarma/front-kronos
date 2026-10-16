import { NextRequest, NextResponse } from 'next/server';
import { identificar } from '@/lib/portal/acceso';
import { leerBasePersonal } from '@/lib/portal/base-personal';
import { FormacionStorageError, FormacionStorageNoConfigurado } from '@/lib/portal/formacion-storage';
import { EMPRESA_DEL_ORGANIGRAMA, personasPorNodo, type NodoCargo, type PersonaOrganigrama } from '@/lib/portal/organigrama';
import { getJerarquia } from '@/lib/organigrama/tree';
import { prisma } from '@/lib/prisma';

/**
 * ORGANIGRAMA de GSS para el portal (Cristian Baldión, 2026-10-15).
 *
 *   GET /api/portal/organigrama   →   { empresa, nodos: [{ id, nombre, nivel, padre }], personas: { [idCargo]: [...] }, total, avisoPersonas? }
 *
 * El ÁRBOL sale de SynerLink (módulo Organigrama: `cargo` y `cargo_jerarquia` de la empresa GSS): una sola fuente de verdad que se
 * edita desde ese módulo. Las PERSONAS salen de BASE PERSONAL (SharePoint, solo lectura) y se enlazan por cargo; solo se devuelven
 * las de cargos que están en el organigrama y de cada una únicamente empresa, nombre, área, cargo y correo (nunca la cédula).
 * Si BASE PERSONAL falla, el árbol se entrega igual con un `avisoPersonas`. Exige la misma identidad que el resto del portal.
 * La empresa se busca por NOMBRE (`PORTAL_TH_ORGANIGRAMA_EMPRESA`, por defecto «GSS»): el id de una empresa cambia entre ambientes.
 */
export async function GET(request: NextRequest) {
  const quien = await identificar(request);
  if (!quien) return NextResponse.json({ error: 'Sesión no válida.' }, { status: 401 });

  const nombreEmpresa = (process.env.PORTAL_TH_ORGANIGRAMA_EMPRESA ?? '').trim() || EMPRESA_DEL_ORGANIGRAMA;
  let nodos: NodoCargo[];
  try {
    const empresa = await prisma.company.findFirst({ where: { company: nombreEmpresa }, select: { id_company: true, company: true } });
    if (!empresa) return NextResponse.json({ error: `No se encontró la empresa ${nombreEmpresa} en SynerLink. Avise a Tecnología.` }, { status: 404 });
    const filas = await getJerarquia(empresa.id_company);
    nodos = filas.map((f) => ({ id: f.idCargo, nombre: f.nombre, nivel: f.nivel, padre: f.idCargoPadre }));
  } catch (error) {
    console.error('[portal] GET /api/portal/organigrama (árbol):', (error as Error).name);
    return NextResponse.json({ error: 'No se pudo cargar el organigrama. Intente en un momento.' }, { status: 500 });
  }

  let personas: Record<number, PersonaOrganigrama[]> = {};
  let avisoPersonas: string | undefined;
  if (nodos.length > 0) {
    try {
      personas = personasPorNodo(nodos, await leerBasePersonal());
    } catch (error) {
      if (error instanceof FormacionStorageNoConfigurado) {
        console.error('[portal] Organigrama sin SharePoint configurado:', error.detalle);
        avisoPersonas = 'Las personas de cada cargo no están configuradas en este ambiente. Avise a Tecnología.';
      } else {
        console.error('[portal] GET /api/portal/organigrama (personas):', error instanceof FormacionStorageError ? error.message : (error as Error).name);
        const permiso = error instanceof FormacionStorageError && (error.status === 401 || error.status === 403);
        const falta = error instanceof FormacionStorageError && error.status === 404;
        avisoPersonas = permiso
          ? 'El portal no tiene permiso para leer BASE PERSONAL en SharePoint. Avise a Tecnología.'
          : falta
            ? 'No se encontró BASE PERSONAL en SharePoint. Avise a Tecnología.'
            : 'No se pudieron cargar los datos de las personas. Intente en un momento.';
      }
    }
  }
  const total = new Set(Object.values(personas).flat().map((p) => `${p.nombre}|${p.correo}|${p.empresa}`)).size;
  return NextResponse.json(
    { empresa: nombreEmpresa, nodos, personas, total, ...(avisoPersonas ? { avisoPersonas } : {}) },
    { headers: { 'Cache-Control': 'private, no-store' } }
  );
}
