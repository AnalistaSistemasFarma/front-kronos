import type { NextResponse } from 'next/server';
import { obtenerConfig, type NabucoConfig } from '../../../../../lib/transferencias-nabuco/db';
import { getNabucoContext, jsonNoStore, parseId, requireEmpresa, type NabucoContext } from '../../_lib/context';

/** Carga la config del [id] y exige el permiso pedido en SU empresa. */
export async function cargarConfig(
  params: Promise<{ id: string }>,
  nivel: 'leer' | 'admin'
): Promise<{ ctx: NabucoContext; cfg: NabucoConfig } | NextResponse> {
  const ctx = await getNabucoContext();
  if (ctx instanceof Response) return ctx;
  const id = parseId((await params).id);
  if (!id) return jsonNoStore({ error: 'Configuración no válida' }, 400);
  const cfg = await obtenerConfig(id);
  if (!cfg) return jsonNoStore({ error: 'Configuración no encontrada' }, 404);
  const denegado = requireEmpresa(ctx, cfg.id_company, nivel);
  if (denegado) return denegado;
  return { ctx, cfg };
}
