import { NextResponse } from 'next/server';
import { canAuditAgents } from '../../../../../../../lib/chat/audit-access';
import {
  jsonNoStore,
  NO_STORE,
  resolveSessionUser,
  serverError,
  unauthorized,
} from '../../../../../../../lib/chat/http';
import { leerHojaDeVida } from '../../../../../../../lib/agent-audit/cv-db';
import { htmlHojaDeVida, logoGssDataUri } from '../../../../../../../lib/agent-audit/cv-pdf';
import { diaColombia } from '../../../../../../../lib/agent-audit/cv';
import { htmlToPdf } from '../../../../../../../lib/sgc/pdf/render';
import { SgcError } from '../../../../../../../lib/sgc/errors';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * HOJA DE VIDA EN PDF (marca GSS), para entregar a Gobierno de IA.
 *
 *   GET /api/chat/auditoria/hoja-de-vida/<code>/pdf   → sesión + permiso de auditoría.
 *
 * Usa el mismo Chrome headless del SGC (puppeteer, ya instalado: sin
 * dependencias nuevas), con JavaScript apagado y sin red. El HTML se arma en
 * el servidor escapando todo el texto (lib/agent-audit/cv-pdf.ts).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const user = await resolveSessionUser();
    if (!user) return unauthorized();
    if (!(await canAuditAgents(user.email))) {
      return jsonNoStore(
        { error: 'La auditoría de agentes está reservada a la administración.' },
        { status: 403 }
      );
    }
    const { code } = await params;
    const ficha = await leerHojaDeVida(decodeURIComponent(code).toLowerCase());
    if (!ficha) return jsonNoStore({ error: 'No existe ese agente.' }, { status: 404 });

    const html = htmlHojaDeVida(ficha, {
      generadoPor: user.email,
      generadoEl: new Date(),
      logo: await logoGssDataUri(),
    });
    let pdf: Uint8Array;
    try {
      pdf = await htmlToPdf(html);
    } catch (err) {
      if (err instanceof SgcError) return jsonNoStore({ error: err.message }, { status: 503 });
      throw err;
    }
    const nombre = `hoja-de-vida-${ficha.agente.code}-${diaColombia(new Date())}.pdf`;
    return new NextResponse(Buffer.from(pdf), {
      status: 200,
      headers: {
        ...NO_STORE,
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${nombre}"`,
      },
    });
  } catch (error) {
    return serverError('GET /api/chat/auditoria/hoja-de-vida/[code]/pdf', error);
  }
}
