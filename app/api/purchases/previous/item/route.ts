import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '../../../auth/[...nextauth]/route';
import { companySap } from '../../../../../lib/purchases/authorization';
import { previousCompanies } from '../../../../../lib/purchases/previousAccess';
import { sapGet, sapLogout, SapError } from '../../../../../lib/sap/serviceLayer';

/**
 * Una solicitud de compra anterior completa (para duplicarla). Mismo acceso que el listado:
 * la propia (su usuario de SAPSEND) o cualquiera si lee Compras en la empresa.
 * GET ?companyId&docEntry -> { item }
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const sp = new URL(request.url).searchParams;
    const companyId = Number(sp.get('companyId'));
    const docEntry = Number(sp.get('docEntry'));
    if (!companyId || !Number.isInteger(docEntry) || docEntry <= 0) {
      return NextResponse.json({ error: 'Falta companyId o docEntry' }, { status: 400 });
    }
    const c = (await previousCompanies(session.user.email)).find((x) => x.idCompany === companyId);
    if (!c) return NextResponse.json({ error: 'Sin acceso a esta empresa' }, { status: 403 });
    const sap = await companySap(companyId);
    try {
      const item = await sapGet<Record<string, unknown>>(sap, `Drafts(${docEntry})`);
      if (item.DocObjectCode !== 'oPurchaseRequest') return NextResponse.json({ error: 'No es una solicitud de compra' }, { status: 404 });
      const own = c.sapsendUserId != null && Number(item.U_SEND_UserId) === Number(c.sapsendUserId);
      if (!own && !c.canSeeAll) return NextResponse.json({ error: 'Solo puede duplicar sus propias solicitudes' }, { status: 403 });
      // Nombres de los anexos (solo para ver qué tenía; al duplicar no se copian).
      let attachments: string[] = [];
      if (item.AttachmentEntry) {
        const att = await sapGet<{ Attachments2_Lines?: Record<string, unknown>[] }>(sap, `Attachments2(${item.AttachmentEntry})`).catch(() => null);
        attachments = (att?.Attachments2_Lines ?? []).map((l) => {
          const base = String(l.FileName ?? '');
          const ext = l.FileExtension ? `.${String(l.FileExtension)}` : '';
          return ext && !base.toLowerCase().endsWith(ext.toLowerCase()) ? `${base}${ext}` : base;
        });
      }
      return NextResponse.json({ item, attachments }, { headers: { 'Cache-Control': 'no-store' } });
    } finally {
      await sapLogout(sap).catch(() => undefined);
    }
  } catch (error) {
    if (error instanceof SapError) return NextResponse.json({ error: error.friendly }, { status: error.status });
    console.error('Error leyendo solicitud de compra anterior:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
