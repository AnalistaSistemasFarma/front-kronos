import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../../auth/[...nextauth]/route';
import { sql, withMssqlPool } from '@/lib/mssqlPool';
import { buildDocumentFlow, emailsInFlow } from '@/lib/orion/documentFlow';
import { ORION_SIGNATURE_FIELD_TYPE } from '@/lib/orion/fieldType';
import { parseOrionSignatureBagBag } from '@/lib/orion/formValue';
import { userHasOrionTaskOnRequest } from '@/lib/orion/signerAuthorizations';
import {
  resolveOrionActorUserId,
  userCanManageOrionRequest,
  userIsOrionFlowSignatureResponsible,
} from '@/lib/orion/service';
import type { OrionSignatureBagBag } from '@/lib/orion/types';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

/** ¿El correo es parte del flujo de este documento (preparadora, validador, aprobador o firmante)? */
function isInFlow(bag: OrionSignatureBagBag, fileId: string, email: string): boolean {
  const me = email.trim().toLowerCase();
  const same = (value: string | null | undefined) => String(value ?? '').trim().toLowerCase() === me;
  const drafts = Object.values(bag.drafts ?? {}).filter((d) => d.fileId === fileId || d.pdfFileId === fileId);
  const docIds = new Set([fileId, ...drafts.map((d) => d.pdfFileId).filter((v): v is string => Boolean(v))]);
  for (const d of drafts) {
    if (same(d.createdByEmail)) return true;
    if (d.internalReview?.approvals.some((a) => same(a.email))) return true;
    if (d.clientReview?.reviewers.some((r) => same(r.email))) return true;
  }
  for (const id of docIds) {
    const doc = bag.documents[id];
    if (!doc) continue;
    if (doc.signers?.some((s) => same(s.email))) return true;
    if (doc.review?.approvals.some((a) => same(a.email))) return true;
  }
  return false;
}

function fileExistsInBag(bag: OrionSignatureBagBag, fileId: string): boolean {
  if (bag.documents?.[fileId]) return true;
  return Object.values(bag.drafts ?? {}).some(
    (d) => d.fileId === fileId || d.pdfFileId === fileId
  );
}

/**
 * GET /api/integrations/orion/document-flow?requestId=123&fileId=abc
 * Flujo del documento para «Ver detalle»: solo nombres, estado y fecha.
 * Acceso: parte del flujo, tarea Orion en la solicitud, o preparador
 * asignado al flujo (permiso Preparar + lista Preparadores documento).
 * Solo base de datos (sin Orion).
 */
export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    const email = session?.user?.email?.trim();
    if (!email) return NextResponse.json({ error: 'No autorizado' }, { status: 401, headers: NO_STORE });

    const { searchParams } = new URL(req.url);
    const requestId = Number(searchParams.get('requestId'));
    const fileId = String(searchParams.get('fileId') || '').trim();
    if (!Number.isInteger(requestId) || requestId <= 0 || !fileId || fileId.length > 200) {
      return NextResponse.json({ error: 'Solicitud o documento no válidos' }, { status: 400, headers: NO_STORE });
    }

    const result = await withMssqlPool(async (pool) => {
      const actorId = await resolveOrionActorUserId(pool, {
        userId: session?.user?.id ? String(session.user.id) : null,
        email,
      });

      // Bag + meta de solicitud (puede no existir campo Orion).
      const bagRow = await pool
        .request()
        .input('id', sql.Int, requestId)
        .input('fieldType', sql.NVarChar(30), ORION_SIGNATURE_FIELD_TYPE)
        .query(`
          SELECT TOP 1
            rfv.value_text,
            rg.created_at,
            urq.name AS requester_name
          FROM process_category_request_general pcr
          INNER JOIN process_form_field pff ON pff.id_process_category = pcr.id_process_category
          INNER JOIN requests_general rg ON rg.id = @id
          LEFT JOIN request_form_value rfv
            ON rfv.id_form_field = pff.id AND rfv.id_request_general = @id
          LEFT JOIN [user] urq ON urq.id = rg.id_requester
          WHERE pcr.id_request_general = @id
            AND pff.field_type = @fieldType
            AND pff.active = 1
          ORDER BY pff.display_order, pff.id
        `);
      const row = bagRow.recordset[0] as
        | { value_text: string | null; created_at: Date | null; requester_name: string | null }
        | undefined;
      const bag = parseOrionSignatureBagBag(row?.value_text ?? null);

      // Autorizar ANTES de revelar si hay documentos de firma (evita enumeración).
      let allowed = isInFlow(bag, fileId, email);
      if (!allowed && actorId) {
        const [hasTask, isFlowResponsible, canManage] = await Promise.all([
          userHasOrionTaskOnRequest(pool, { requestId, userId: actorId, fileId }),
          userIsOrionFlowSignatureResponsible(pool, requestId, actorId),
          userCanManageOrionRequest(
            pool,
            requestId,
            actorId,
            session?.user?.role === 'admin' || session?.user?.role === 'superadmin'
          ),
        ]);
        allowed = hasTask || (canManage && isFlowResponsible);
      }
      if (!allowed) return { status: 403 as const };

      if (!row || !fileExistsInBag(bag, fileId)) return { status: 404 as const };

      const emails = emailsInFlow(bag, fileId);
      const namesReq = pool.request().input('id', sql.Int, requestId);
      const emailParams = emails.map((e, i) => {
        namesReq.input(`e${i}`, sql.NVarChar(320), e);
        return `@e${i}`;
      });
      const namesResult = emailParams.length
        ? await namesReq.query(`
            SELECT LOWER(LTRIM(RTRIM(email))) AS email, name
              FROM [user]
             WHERE LOWER(LTRIM(RTRIM(email))) IN (${emailParams.join(', ')});
          `)
        : { recordset: [] as { email: string; name: string | null }[] };

      const names: Record<string, string> = {};
      for (const n of namesResult.recordset ?? []) if (n.name?.trim()) names[n.email] = n.name.trim();

      return {
        status: 200 as const,
        flow: buildDocumentFlow(bag, fileId, {
          names,
          request: {
            createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
            requesterName: row.requester_name,
          },
        }),
      };
    });

    if (result.status === 403) {
      return NextResponse.json({ error: 'No hace parte del flujo de este documento' }, { status: 403, headers: NO_STORE });
    }
    if (result.status === 404) {
      return NextResponse.json({ error: 'Esta solicitud no tiene documentos de firma' }, { status: 404, headers: NO_STORE });
    }
    return NextResponse.json({ flow: result.flow }, { headers: NO_STORE });
  } catch (error) {
    console.error('[orion/document-flow]', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'No se pudo cargar el flujo del documento' }, { status: 500, headers: NO_STORE });
  }
}
