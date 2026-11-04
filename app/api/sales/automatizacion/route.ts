import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { prisma } from '../../../../lib/prisma';
import { salesAdminCompanies } from '../../../../lib/sales/access';
import { companySap } from '../../../../lib/purchases/authorization';
import { sapLogout } from '../../../../lib/sap/serviceLayer';
import {
  docAction,
  findPending,
  getConfig,
  panelData,
  parseUserSigns,
  runAutomation,
  saveConfig,
  summaryText,
  validateConfig,
} from '../../../../lib/sales/automation';

/**
 * Panel de la automatización de borradores de Salesforce (estilo Transferencias Nabuco).
 * Solo con el permiso «Ventas · Automatización (administración)» en la empresa.
 *  GET  ?companyId            -> empresas, configuración, KPIs, registro y corridas
 *  GET  ?companyId&pendientes -> borradores pendientes en SAP (mismo filtro que la corrida)
 *  PUT  { companyId, config } -> guarda la configuración y su tarea del programador
 *  POST { companyId, accion: 'ejecutar' | 'simular' | 'crear' | 'descartar' | 'reactivar', docEntries?, idDoc? }
 */
async function ctx(request: NextRequest, companyIdRaw: unknown) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  const companies = await salesAdminCompanies(email);
  const companyId = Number(companyIdRaw) || companies[0]?.idCompany || 0;
  if (!companies.some((c) => c.idCompany === companyId)) {
    return { error: NextResponse.json({ error: 'No tiene el permiso «Ventas · Automatización (administración)» en esta empresa.', companies }, { status: 403 }) };
  }
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  return { email, companies, companyId, userId: user?.id ?? null };
}

export async function GET(request: NextRequest) {
  try {
    const sp = new URL(request.url).searchParams;
    const c = await ctx(request, sp.get('companyId'));
    if ('error' in c) return c.error;
    const cfg = await getConfig(c.companyId);
    if (sp.has('pendientes')) {
      if (!cfg) return NextResponse.json({ pendientes: [] });
      const sap = await companySap(c.companyId);
      try {
        return NextResponse.json({ pendientes: await findPending(sap, cfg, 200) });
      } finally {
        await sapLogout(sap);
      }
    }
    let solicitanteEmail: string | null = null;
    if (cfg?.id_user_solicitante) {
      const u = await prisma.user.findUnique({ where: { id: cfg.id_user_solicitante }, select: { email: true } });
      solicitanteEmail = u?.email ?? null;
    }
    return NextResponse.json({ companies: c.companies, companyId: c.companyId, config: cfg ? { ...cfg, solicitanteEmail } : null, ...(await panelData(c.companyId)) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('[sales/automatizacion] GET', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error interno' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const c = await ctx(request, body.companyId);
    if ('error' in c) return c.error;
    const raw = body.config ?? {};
    let solicitante: string | null = null;
    const solEmail = String(raw.solicitanteEmail ?? '').trim().toLowerCase();
    if (solEmail) {
      const u = await prisma.user.findUnique({ where: { email: solEmail }, select: { id: true } });
      if (!u) return NextResponse.json({ error: `No existe en SynerLink el usuario ${solEmail}.` }, { status: 422 });
      solicitante = u.id;
    }
    const input = {
      activo: Boolean(raw.activo),
      simulacion: raw.simulacion !== false,
      intervalo_min: Number(raw.intervalo_min ?? 10),
      user_signs: parseUserSigns(raw.user_signs ?? raw.user_sign),
      desde_fecha: raw.desde_fecha ? String(raw.desde_fecha) : null,
      id_user_solicitante: solicitante,
    };
    const errors = validateConfig(input);
    if (errors.length) return NextResponse.json({ error: errors.join(' ') }, { status: 422 });
    await saveConfig(c.companyId, input, c.userId ?? c.email);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[sales/automatizacion] PUT', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error interno' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const c = await ctx(request, body.companyId);
    if ('error' in c) return c.error;
    const accion = String(body.accion ?? '');
    const docEntries = Array.isArray(body.docEntries) ? body.docEntries.map(Number).filter((n: number) => Number.isInteger(n) && n > 0).slice(0, 30) : undefined;
    if (accion === 'descartar' || accion === 'reactivar') {
      const ok = await docAction(c.companyId, Number(body.idDoc), accion, c.userId ?? c.email);
      return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'No se pudo cambiar ese registro.' }, { status: 409 });
    }
    if (accion !== 'ejecutar' && accion !== 'simular' && accion !== 'crear') {
      return NextResponse.json({ error: 'Acción no válida.' }, { status: 400 });
    }
    if (accion !== 'ejecutar' && !docEntries?.length) return NextResponse.json({ error: 'Elija al menos un borrador.' }, { status: 400 });
    const r = await runAutomation({
      idCompany: c.companyId,
      origen: accion === 'ejecutar' ? 'manual' : 'asistida',
      modo: accion === 'ejecutar' ? 'auto' : accion,
      usuario: c.userId,
      docEntries,
    });
    return NextResponse.json({ ok: true, resumen: summaryText(r), ...r });
  } catch (e) {
    console.error('[sales/automatizacion] POST', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error interno' }, { status: 500 });
  }
}
