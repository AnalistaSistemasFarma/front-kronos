import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '../../../auth/[...nextauth]/route';
import { readPurchaseSession } from '../../../../../lib/purchases/requestAccess';
import { mimeFor } from '../../../../../lib/purchases/attachments';
import { sapGet, sapGetBinary, sapLogout, SapError } from '../../../../../lib/sap/serviceLayer';

/**
 * Ver o descargar un adjunto (cotización o anexo) del borrador de compra desde
 * el Attachments2 de SAP. GET ?companyId&docEntry&line[&requestId][&download=1].
 * Mismo acceso que el listado de adjuntos.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const sp = new URL(request.url).searchParams;
    const companyId = Number(sp.get('companyId'));
    const docEntry = Number(sp.get('docEntry'));
    const line = Number(sp.get('line'));
    const requestId = Number(sp.get('requestId')) || null;
    if (!companyId || !Number.isInteger(docEntry) || docEntry <= 0 || !Number.isInteger(line) || line < 0) {
      return NextResponse.json({ error: 'Faltan companyId, docEntry o line' }, { status: 400 });
    }

    const sap = await readPurchaseSession(session.user.email, companyId, docEntry, requestId);
    if (!sap) return NextResponse.json({ error: 'Sin acceso a esta solicitud de compra' }, { status: 403 });
    try {
      const draft = await sapGet<{ AttachmentEntry?: number | null }>(sap, `Drafts(${docEntry})?$select=AttachmentEntry`);
      if (!draft.AttachmentEntry) return NextResponse.json({ error: 'La solicitud no tiene adjuntos' }, { status: 404 });
      const att = await sapGet<{ Attachments2_Lines?: Array<Record<string, unknown>> }>(
        sap,
        `Attachments2(${draft.AttachmentEntry})`
      );
      const l = (att.Attachments2_Lines ?? []).find((x) => Number(x.LineNum) === line);
      if (!l) return NextResponse.json({ error: 'Adjunto no encontrado' }, { status: 404 });
      const base = String(l.FileName ?? '');
      const ext = l.FileExtension ? String(l.FileExtension) : '';
      const name = ext && !base.toLowerCase().endsWith(`.${ext.toLowerCase()}`) ? `${base}.${ext}` : base;
      const file = await sapGetBinary(
        sap,
        `Attachments2(${draft.AttachmentEntry})/$value?filename='${encodeURIComponent(name.replace(/'/g, "''"))}'`
      );
      const disposition = sp.get('download') === '1' ? 'attachment' : 'inline';
      return new NextResponse(new Uint8Array(file.data), {
        headers: {
          'Content-Type': mimeFor(name) !== 'application/octet-stream' ? mimeFor(name) : file.contentType,
          'Content-Disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(name)}`,
          'Cache-Control': 'private, no-store',
        },
      });
    } finally {
      await sapLogout(sap);
    }
  } catch (error) {
    if (error instanceof SapError) return NextResponse.json({ error: error.friendly }, { status: error.status });
    console.error('Error descargando adjunto de compra:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
