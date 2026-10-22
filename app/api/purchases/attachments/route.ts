import { randomUUID } from 'crypto';
import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { getCompanyEndpointForUser } from '../../../../lib/purchases/access';
import { mimeFor, uniqueSapFilename, validateAttachments } from '../../../../lib/purchases/attachments';
import { EDITABLE_STATES } from '../../../../lib/purchases/drafts';
import { sapGet, sapLogin, sapLogout, sapPatch, sapUploadFiles, SapError } from '../../../../lib/sap/serviceLayer';

/**
 * Adjuntos (cotizaciones y anexos) de un borrador de solicitud de compra, en el
 * Attachments2 de SAP: el mismo registro que ve SAPSEND (AttachmentEntry del Draft)
 * y que la firme hereda al aprobar.
 *
 * GET  ?companyId&docEntry -> lineas del registro de adjuntos (permiso de lectura).
 * POST multipart: companyId, docEntry, archivos (cualquier nombre de campo).
 *      Sin registro previo: POST Attachments2 + PATCH Drafts { AttachmentEntry } con If-Match.
 *      Con registro: PATCH Attachments2(n), que agrega los archivos.
 *      Solo en B o ENC (mismos estados en que se edita). Permiso de escritura.
 */

function errorResponse(error: unknown, context: string) {
  if (error instanceof SapError) {
    const msg = error.isPreconditionFailed
      ? 'La solicitud cambio mientras se adjuntaba (posiblemente en SAPSEND). Recargue e intente de nuevo.'
      : error.friendly;
    return NextResponse.json({ error: msg }, { status: error.isPreconditionFailed ? 409 : error.status });
  }
  console.error(context, error);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const companyId = Number(searchParams.get('companyId'));
    const docEntry = Number(searchParams.get('docEntry'));
    if (!companyId || !Number.isInteger(docEntry) || docEntry <= 0) {
      return NextResponse.json({ error: 'Falta companyId o docEntry' }, { status: 400 });
    }

    const company = await getCompanyEndpointForUser(session.user.email, companyId);
    if (!company?.endpoint) return NextResponse.json({ error: 'Sin acceso a esta empresa' }, { status: 403 });

    const sap = await sapLogin(company.endpoint);
    try {
      const draft = await sapGet<{ AttachmentEntry?: number | null }>(sap, `Drafts(${docEntry})?$select=AttachmentEntry`);
      if (!draft.AttachmentEntry) return NextResponse.json({ attachmentEntry: null, files: [] });
      const att = await sapGet<{ Attachments2_Lines?: Array<Record<string, unknown>> }>(
        sap,
        `Attachments2(${draft.AttachmentEntry})`
      );
      // En SAP, FileName puede traer ya la extension (visto en Farmalogica: "x.pdf" + FileExtension "pdf").
      const files = (att.Attachments2_Lines ?? []).map((l) => {
        const base = String(l.FileName ?? '');
        const ext = l.FileExtension ? `.${String(l.FileExtension)}` : '';
        return {
          line: l.LineNum,
          name: ext && !base.toLowerCase().endsWith(ext.toLowerCase()) ? `${base}${ext}` : base,
          date: l.AttachmentDate ?? null,
        };
      });
      return NextResponse.json({ attachmentEntry: draft.AttachmentEntry, files });
    } finally {
      await sapLogout(sap);
    }
  } catch (error) {
    return errorResponse(error, 'Error listando adjuntos de compra:');
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const form = await request.formData().catch(() => null);
    if (!form) return NextResponse.json({ error: 'El cuerpo debe ser multipart/form-data' }, { status: 400 });

    const companyId = Number(form.get('companyId'));
    const docEntry = Number(form.get('docEntry'));
    if (!companyId || !Number.isInteger(docEntry) || docEntry <= 0) {
      return NextResponse.json({ error: 'Falta companyId o docEntry' }, { status: 400 });
    }

    const files = [...form.values()].filter((v): v is File => typeof v === 'object' && v !== null && 'arrayBuffer' in v);
    const check = validateAttachments(files.map((f) => ({ name: f.name, size: f.size })));
    if (check.error) return NextResponse.json({ error: check.error }, { status: 400 });
    if (check.rejected.length > 0) {
      return NextResponse.json(
        { error: 'Hay archivos que no cumplen las reglas de adjuntos.', rejected: check.rejected },
        { status: check.rejected.some((r) => r.reason === 'size') ? 413 : 422 }
      );
    }

    const company = await getCompanyEndpointForUser(session.user.email, companyId, 'write');
    if (!company?.endpoint) {
      return NextResponse.json({ error: 'No tiene permiso de escritura en esta empresa' }, { status: 403 });
    }

    const uniqueId = randomUUID().slice(0, 8);
    const parts = await Promise.all(
      files.map(async (f) => ({
        filename: uniqueSapFilename(f.name, uniqueId),
        contentType: mimeFor(f.name),
        data: Buffer.from(await f.arrayBuffer()),
      }))
    );

    const sap = await sapLogin(company.endpoint);
    try {
      const draft = await sapGet<Record<string, unknown>>(
        sap,
        `Drafts(${docEntry})?$select=DocEntry,DocObjectCode,U_SEND_State,AttachmentEntry`
      );
      if (draft.DocObjectCode !== 'oPurchaseRequest') {
        return NextResponse.json({ error: 'El documento no es una solicitud de compra' }, { status: 404 });
      }
      const state = String(draft.U_SEND_State ?? '');
      if (!(EDITABLE_STATES as readonly string[]).includes(state)) {
        return NextResponse.json(
          { error: `Solo se puede adjuntar en estado B o ENC; estado actual: ${state || 'sin estado'}` },
          { status: 409 }
        );
      }

      const existing = Number(draft.AttachmentEntry) || 0;
      if (existing > 0) {
        await sapUploadFiles(sap, `Attachments2(${existing})`, parts, 'PATCH');
        return NextResponse.json({ ok: true, attachmentEntry: existing, uploaded: parts.map((p) => p.filename) }, { status: 201 });
      }

      const created = await sapUploadFiles<{ AbsoluteEntry: number }>(sap, 'Attachments2', parts, 'POST');
      const entry = Number(created?.AbsoluteEntry);
      if (!entry) return NextResponse.json({ error: 'SAP no devolvio el registro de adjuntos' }, { status: 502 });
      await sapPatch(sap, `Drafts(${docEntry})`, { AttachmentEntry: entry }, false, {
        ifMatch: draft['odata.etag'] as string | undefined,
      });
      return NextResponse.json({ ok: true, attachmentEntry: entry, uploaded: parts.map((p) => p.filename) }, { status: 201 });
    } finally {
      await sapLogout(sap);
    }
  } catch (error) {
    return errorResponse(error, 'Error adjuntando archivos de compra:');
  }
}
