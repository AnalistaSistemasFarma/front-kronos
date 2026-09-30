import { prisma } from '../../../../lib/prisma';
import { createInitialDocument, listMasterDocuments } from '../../../../lib/sgc/db/documents';
import { uploadToSgcStorage } from '../../../../lib/sgc/onedrive';
import { companyAccess, errorResponse, getSgcRequestContext, jsonNoStore, parseCompanyParam } from '../_lib/context';

export const dynamic = 'force-dynamic';

/**
 * GET /api/sgc/documents?company=3[&status=vigente|obsoleto|anulado|borrador|todos]
 * Listado maestro: solo lo que la persona puede consultar (vigentes; Calidad
 * puede pedir otros estados). La búsqueda y los filtros se aplican en la
 * página sobre este listado.
 */
export async function GET(request: Request) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const idCompany = parseCompanyParam(request.url);
    if (!idCompany) return jsonNoStore({ error: 'Falta la empresa' }, 400);
    const access = companyAccess(ctx, idCompany);
    if (!access) return jsonNoStore({ error: 'Sin acceso al SGC de esta empresa' }, 403);
    const status = new URL(request.url).searchParams.get('status');
    const documents = await listMasterDocuments(prisma, access, ctx.subject, { status });
    return jsonNoStore({ documents });
  } catch (error) {
    return errorResponse(error, 'documents');
  }
}

function fileField(form: FormData, name: string): File | null {
  const value = form.get(name);
  return value instanceof File && value.size > 0 ? value : null;
}

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

/**
 * POST /api/sgc/documents (multipart/form-data) — CARGA ADMINISTRATIVA
 * INICIAL de un documento vigente, solo Aseguramiento de Calidad (Sprint 1).
 * Campos: company, idProcess, idDocumentType, title, code?, confidentiality,
 * idOwnerDepartment?, versionNumber, effectiveDate (YYYY-MM-DD),
 * changeDescription?, pdf (obligatorio), source? (Word).
 */
export async function POST(request: Request) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const form = await request.formData().catch(() => null);
    if (!form) return jsonNoStore({ error: 'Se esperaba un formulario con archivos' }, 400);
    const idCompany = Number(text(form, 'company'));
    if (!Number.isInteger(idCompany) || idCompany < 1) return jsonNoStore({ error: 'Falta la empresa' }, 400);
    if (!companyAccess(ctx, idCompany, 'canQuality')) {
      return jsonNoStore({ error: 'Solo Aseguramiento de Calidad carga documentos vigentes' }, 403);
    }
    const pdf = fileField(form, 'pdf');
    const source = fileField(form, 'source');
    const owner = text(form, 'idOwnerDepartment');
    const result = await createInitialDocument(
      prisma,
      uploadToSgcStorage,
      {
        idCompany,
        idProcess: Number(text(form, 'idProcess')),
        idDocumentType: Number(text(form, 'idDocumentType')),
        title: text(form, 'title'),
        code: text(form, 'code'),
        confidentiality: text(form, 'confidentiality'),
        idOwnerDepartment: owner ? Number(owner) : null,
        versionNumber: Number(text(form, 'versionNumber') || '1'),
        effectiveDate: text(form, 'effectiveDate'),
        changeDescription: text(form, 'changeDescription'),
        pdf: { bytes: pdf ? new Uint8Array(await pdf.arrayBuffer()) : new Uint8Array(), fileName: pdf?.name ?? '' },
        source: source
          ? { bytes: new Uint8Array(await source.arrayBuffer()), fileName: source.name, contentType: source.type }
          : null,
      },
      ctx.actor
    );
    return jsonNoStore(result, 201);
  } catch (error) {
    return errorResponse(error, 'documents:carga');
  }
}
