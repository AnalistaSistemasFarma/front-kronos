/**
 * MÓDULO FORMACIÓN — sesión de SynerLink para las rutas /api/formacion/*.
 * Todas exigen el permiso del módulo (o la transición de PORTAL_TH_FORMADORES).
 */
import 'server-only';
import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../app/api/auth/[...nextauth]/route';
import { formadoresDePortal } from '../portal/config';
import { contextoAdmin } from './servidor';
import { normalizarCorreo, type ContextoAdmin } from './reglas';

export const SIN_CACHE = { 'Cache-Control': 'no-store' };

export async function correoDeSesion(): Promise<string | null> {
  try {
    const sesion = await getServerSession(authOptions);
    return sesion?.user?.email ?? null;
  } catch {
    return null;
  }
}

export type ResultadoAdmin = { ok: true; correo: string; ctx: ContextoAdmin } | { ok: false; respuesta: NextResponse };

/** Exige sesión y permiso del módulo Formación. */
export async function exigirAdminFormacion(): Promise<ResultadoAdmin> {
  const correo = await correoDeSesion();
  if (!correo) return { ok: false, respuesta: NextResponse.json({ error: 'Sesión no válida.' }, { status: 401, headers: SIN_CACHE }) };
  const ctx = await contextoAdmin(correo);
  if (!ctx.esGlobal && ctx.empresas.length === 0 && formadoresDePortal().includes(normalizarCorreo(correo))) {
    ctx.esGlobal = true;
  }
  if (!ctx.esGlobal && ctx.empresas.length === 0) {
    return {
      ok: false,
      respuesta: NextResponse.json(
        { error: 'No tiene habilitado el módulo Formación. Solicítelo a la administración de SynerLink.' },
        { status: 403, headers: SIN_CACHE }
      ),
    };
  }
  return { ok: true, correo, ctx };
}
