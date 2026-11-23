import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { companySap } from '../../../../lib/purchases/authorization';
import { PREVIOUS_PAGE, previousPath, previousRange } from '../../../../lib/purchases/previous';
import { previousCompanies } from '../../../../lib/purchases/previousAccess';
import { sapGet, sapLogout, SapError } from '../../../../lib/sap/serviceLayer';

/**
 * Solicitudes de compra anteriores (SAPSEND) de todas las empresas del usuario, leídas en vivo de SAP.
 * GET ?from&to&q&scope=mine|all&companyId -> { companies, rows, errors }
 *  - mine: las que creó el usuario (su usuario de SAPSEND en cada empresa).
 *  - all: todas las de la empresa, solo donde tiene permiso de lectura de Compras.
 * Hasta 200 por empresa (las más recientes). Provisional mientras convive SAPSEND.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const sp = new URL(request.url).searchParams;
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
    const { from, to } = previousRange(sp.get('from'), sp.get('to'), today);
    const scope = sp.get('scope') === 'all' ? 'all' : 'mine';
    const onlyCompany = Number(sp.get('companyId')) || null;
    const q = (sp.get('q') ?? '').slice(0, 60);

    const companies = await previousCompanies(session.user.email);
    const rows: Record<string, unknown>[] = [];
    const errors: { companyId: number; company: string; error: string }[] = [];
    for (const c of companies) {
      if (onlyCompany && c.idCompany !== onlyCompany) continue;
      const userFilter = scope === 'all' && c.canSeeAll ? null : c.sapsendUserId;
      if (userFilter == null && !(scope === 'all' && c.canSeeAll)) continue;
      let sap = null;
      try {
        sap = await companySap(c.idCompany);
        const data = await sapGet<{ value?: Record<string, unknown>[] }>(
          sap,
          previousPath({ from, to, sapsendUserId: userFilter, q }),
          { Prefer: `odata.maxpagesize=${PREVIOUS_PAGE}` }
        );
        for (const r of data.value ?? []) rows.push({ ...r, companyId: c.idCompany, companyName: c.companyName });
      } catch (e) {
        errors.push({ companyId: c.idCompany, company: c.companyName, error: e instanceof SapError ? e.friendly : 'No se pudo consultar SAP' });
      } finally {
        if (sap) await sapLogout(sap).catch(() => undefined);
      }
    }
    rows.sort((a, b) => String(b.DocDate ?? '').localeCompare(String(a.DocDate ?? '')));
    return NextResponse.json(
      {
        from,
        to,
        companies: companies.map((c) => ({ idCompany: c.idCompany, companyName: c.companyName, canSeeAll: c.canSeeAll, hasProfile: c.sapsendUserId != null })),
        rows,
        errors,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    console.error('Error consultando solicitudes de compra anteriores:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
