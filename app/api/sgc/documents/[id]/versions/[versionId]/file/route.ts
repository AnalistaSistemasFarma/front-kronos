import { NextResponse } from 'next/server';
import { prisma } from '../../../../../../../../lib/prisma';
import { SGC_AUDIT_ACTIONS, writeSgcAudit } from '../../../../../../../../lib/sgc/audit';
import { getVersionForViewer } from '../../../../../../../../lib/sgc/db/documents';
import { downloadVerifiedPdf } from '../../../../../../../../lib/sgc/onedrive';
import { stampControlledCopy, type SgcWatermarkInfo } from '../../../../../../../../lib/sgc/watermark';
import { NO_STORE, errorResponse, getSgcRequestContext, jsonNoStore, rateLimitResponse } from '../../../../../_lib/context';

export const dynamic = 'force-dynamic';

const MODES = ['consulta', 'descarga', 'impresion'] as const;
type Mode = (typeof MODES)[number];

const ACTION: Record<Mode, (typeof SGC_AUDIT_ACTIONS)[keyof typeof SGC_AUDIT_ACTIONS]> = {
  consulta: SGC_AUDIT_ACTIONS.documentoConsulta,
  descarga: SGC_AUDIT_ACTIONS.documentoDescarga,
  impresion: SGC_AUDIT_ACTIONS.documentoImpresion,
};

/**
 * GET /api/sgc/documents/<id>/versions/<versionId>/file?modo=consulta|descarga|impresion
 *
 * Entrega el PDF de la versión para el VISOR del SGC, siempre estampado con
 * la marca de "copia controlada" (quién y cuándo) y tras verificar su hash
 * SHA-256. `consulta` (por defecto) sale inline y sin caché; `descarga` e
 * `impresion` exigen el permiso excepcional vigente. Cada entrega queda en la
 * auditoría; un intento sin permiso también (acceso.denegado).
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string; versionId: string }> }) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    // Sprint 6: sin ningún acceso al SGC no se consulta nada ni se escribe auditoría (evita llenar audit_log).
    if (ctx.access.length === 0) return jsonNoStore({ error: 'Sin acceso al SGC' }, 403);
    const limited = rateLimitResponse('archivo', ctx.email);
    if (limited) return limited;
    const { id, versionId } = await params;
    const rawMode = new URL(request.url).searchParams.get('modo') ?? 'consulta';
    if (!(MODES as readonly string[]).includes(rawMode)) return jsonNoStore({ error: 'Modo inválido' }, 400);
    const mode = rawMode as Mode;

    const found = await getVersionForViewer(prisma, ctx.access, ctx.subject, Number(id), Number(versionId));
    const allowed =
      !!found && (mode === 'consulta' || (mode === 'descarga' ? found.permissions.canDownload : found.permissions.canPrint));

    if (!found || !allowed) {
      await writeSgcAudit(prisma, {
        idCompany: found?.document.idCompany ?? null,
        actorEmail: ctx.email,
        action: SGC_AUDIT_ACTIONS.accesoDenegado,
        entity: 'document_version',
        entityId: Number(versionId) || null,
        detail: `Intento de ${mode} sin permiso (documento ${id}).`,
        ip: ctx.actor.ip,
        userAgent: ctx.actor.userAgent,
      });
      return found
        ? jsonNoStore({ error: `No tiene permiso de ${mode === 'descarga' ? 'descarga' : 'impresión'} sobre este documento` }, 403)
        : jsonNoStore({ error: 'Documento no encontrado' }, 404);
    }

    const original = await downloadVerifiedPdf(found.version.pdf_item_id, found.version.pdf_sha256);
    const now = new Date();
    const info: SgcWatermarkInfo = {
      code: found.document.code,
      versionNumber: found.version.version_number,
      viewerEmail: ctx.email,
      at: now,
      mode,
      // Sprint 4: una versión obsoleta o anulada sale marcada como tal; una aprobada en divulgación, como «aún no vigente».
      state: found.version.status === 'obsoleto' ? 'obsoleto' : found.version.status === 'anulado' ? 'anulado' : found.version.status === 'borrador' ? 'divulgacion' : 'vigente',
    };
    const stamped = await stampControlledCopy(original, info);

    await writeSgcAudit(prisma, {
      idCompany: found.document.idCompany,
      actorEmail: ctx.email,
      action: ACTION[mode],
      entity: 'document_version',
      entityId: found.version.id_document_version,
      detail: `${found.document.code} V${found.version.version_number} (${mode}).`,
      ip: ctx.actor.ip,
      userAgent: ctx.actor.userAgent,
    });

    const fileName = `${found.document.code} V${found.version.version_number} - copia controlada.pdf`;
    return new NextResponse(Buffer.from(stamped), {
      status: 200,
      headers: {
        ...NO_STORE,
        'Content-Type': 'application/pdf',
        'Content-Disposition': `${mode === 'descarga' ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'SAMEORIGIN',
      },
    });
  } catch (error) {
    return errorResponse(error, 'documents:archivo');
  }
}
