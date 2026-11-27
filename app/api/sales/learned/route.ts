import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { salesEndpointForUser } from '../../../../lib/sales/access';
import { changeLearned, cleanEntries } from '../../../../lib/sales/learnedMappings';

/**
 * Learned item mappings of the PDF offer review (see lib/sales/learnedMappings.ts).
 * POST { action: 'save' | 'forget', companyId, cardCode, source?: 'usuario' | 'agente', entries: [{ clientCode, barcode, description, itemCode, itemName, factor }] }
 * Only users who can create offers in the company. Writes KRONOSDB only (never SAP), with an audit row per key.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const email = session?.user?.email;
    if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const body = await request.json().catch(() => ({}));
    const action = body.action === 'forget' ? 'forget' : body.action === 'save' ? 'save' : null;
    const companyId = Number(body.companyId);
    const cardCode = String(body.cardCode ?? '').trim().slice(0, 50);
    const entries = cleanEntries(body.entries);
    if (!action || !companyId || !cardCode || !entries.length || (action === 'save' && entries.some((e) => !e.itemCode))) {
      return NextResponse.json({ error: 'Faltan datos para recordar el artículo.' }, { status: 400 });
    }
    const access = await salesEndpointForUser(email, companyId, 'write');
    if (!access?.endpoint) return NextResponse.json({ error: 'Sin permiso para crear ofertas en esta empresa.' }, { status: 403 });
    const changed = await changeLearned(action, {
      companyId, cardCode, entries, user: String(session.user?.name || email).slice(0, 320), userEmail: email, source: body.source === 'agente' ? 'agente' : 'usuario',
    });
    return NextResponse.json({ ok: true, changed });
  } catch (error) {
    console.error('Error saving learned item mappings:', error);
    return NextResponse.json({ error: 'No se pudo guardar lo aprendido. Intente de nuevo.' }, { status: 500 });
  }
}
