import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { salesEndpointForUser } from '../../../../lib/sales/access';
import { salesCompanyConfig } from '../../../../lib/sales/companyConfig';
import { MAX_IMPORT_LINES, type ImportLine } from '../../../../lib/sales/linesImport';
import { validateLines } from '../../../../lib/sales/linesValidate';
import { sapLogin, sapLogout, SapError } from '../../../../lib/sap/serviceLayer';

/**
 * Valida contra SAP las líneas leídas de un Excel (cargue de líneas de la oferta):
 *  - el artículo existe, está activo y es de venta;
 *  - la bodega (si viene) existe; si no viene, la bodega por defecto del artículo;
 *  - precio de lista SIEMPRE de SAP (precio especial o lista del cliente / por defecto de la empresa). El precio
 *    del Excel, si viene, es el precio de venta propuesto; si no, se usa el de lista (o 0 si no hay, como SAPSEND).
 * POST { companyId, cardCode, lines: ImportLine[], matchByDescription? } -> { lines, errors, pending }
 *  matchByDescription (PDF leído con IA): si el código no existe en SAP o no viene, se buscan artículos
 *  por la descripción y se devuelven como candidatos («pending») para que el comercial elija.
 */

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const body = await request.json().catch(() => ({}));
    const companyId = Number(body.companyId);
    const cardCode = String(body.cardCode ?? '').trim().slice(0, 50);
    const input = (Array.isArray(body.lines) ? body.lines : []).slice(0, MAX_IMPORT_LINES) as ImportLine[];
    if (!companyId || !cardCode) return NextResponse.json({ error: 'Elija primero el cliente.' }, { status: 400 });
    if (!input.length) return NextResponse.json({ error: 'El archivo no tiene líneas.' }, { status: 400 });
    const access = await salesEndpointForUser(session.user.email, companyId, 'write');
    if (!access?.endpoint) return NextResponse.json({ error: 'Sin permiso para crear ofertas en esta empresa.' }, { status: 403 });
    const conf = await salesCompanyConfig(companyId);

    const sap = await sapLogin(access.endpoint);
    try {
      const r = await validateLines(sap, {
        cardCode, input, matchByDescription: body.matchByDescription === true,
        descripcionEditable: conf?.descripcionEditable, priceListDefault: conf?.priceListDefault ?? null, defaultWarehouse: conf?.defaultWarehouse ?? null,
      });
      return NextResponse.json(r);
    } finally {
      await sapLogout(sap);
    }
  } catch (error) {
    if (error instanceof SapError) return NextResponse.json({ error: error.friendly }, { status: error.status });
    console.error('Error validando las líneas del Excel:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
