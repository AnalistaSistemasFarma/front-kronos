import { prisma } from '../../../../lib/prisma';
import { getOtConfig, setOtMargenSuperior } from '../../../../lib/bitacora-proceso/db';
import { OT_MARGEN_SUPERIOR_MAX_MM, OT_MARGEN_SUPERIOR_MIN_MM, mmACm, parseMargenSuperiorCm } from '../../../../lib/bitacora-proceso/impresion';
import { errorResponse, getOtRequestContext, jsonNoStore, parseCompanyParam, readJson, requireCompany } from '../_lib/context';

export const dynamic = 'force-dynamic';

/**
 * Print settings of the Bitácora per company (case #8316, 2026-11-23).
 * GET ?company=1 — any person with access to the module (the report needs it to print).
 */
export async function GET(request: Request) {
  try {
    const ctx = await getOtRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const access = requireCompany(ctx, parseCompanyParam(request.url));
    if (access instanceof Response) return access;
    const config = await getOtConfig(prisma, access.idCompany);
    return jsonNoStore({ config: { ...config, margenSuperiorCm: mmACm(config.margenSuperiorMm) } });
  } catch (error) {
    return errorResponse(error, 'config');
  }
}

/** PATCH { company, margen_superior_cm } — only Gestión (supervisor) changes it. */
export async function PATCH(request: Request) {
  try {
    const ctx = await getOtRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const body = await readJson(request);
    const idCompany = Number(body?.company);
    const access = requireCompany(ctx, Number.isInteger(idCompany) && idCompany > 0 ? idCompany : null, 'canManage');
    if (access instanceof Response) return access;
    const mm = parseMargenSuperiorCm(body?.margen_superior_cm);
    if (mm === null) {
      return jsonNoStore({ error: `El margen superior debe estar entre ${mmACm(OT_MARGEN_SUPERIOR_MIN_MM)} y ${mmACm(OT_MARGEN_SUPERIOR_MAX_MM)} cm.` }, 400);
    }
    const config = await setOtMargenSuperior(prisma, access.idCompany, mm, ctx.actor);
    return jsonNoStore({ config: { ...config, margenSuperiorCm: mmACm(config.margenSuperiorMm) } });
  } catch (error) {
    return errorResponse(error, 'config-patch');
  }
}
