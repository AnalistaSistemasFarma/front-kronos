import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { withMssqlPool } from '@/lib/mssqlPool';
import { useGetMicrosoftToken as getMicrosoftToken } from '@/components/microsoft-365/useGetMicrosoftToken';
import { deleteOneDriveItem } from '@/lib/onedrive/graphFolderUpload';
import { userHasDeleteAttachmentsPermission } from '@/lib/attachments/permissions';
import {
  getOrionDocumentFromBag,
  parseOrionSignatureBagBag,
  serializeOrionSignatureBagBag,
} from '@/lib/orion/formValue';
import { findOrionSignatureField } from '@/lib/orion/service';
import sql from 'mssql';

/**
 * Elimina un adjunto de la solicitud en OneDrive.
 * Requiere permiso subproceso “Eliminar adjuntos”.
 *
 * DELETE/POST JSON: { requestId, fileId }
 */
async function handleDelete(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const requestId = Number(body.requestId);
  const fileId = String(body.fileId || '').trim();

  if (!Number.isInteger(requestId) || requestId <= 0 || !fileId) {
    return NextResponse.json(
      { error: 'requestId y fileId son obligatorios' },
      { status: 400 }
    );
  }

  const userId = session.user.id != null ? String(session.user.id) : '';
  if (!userId) {
    return NextResponse.json({ error: 'Usuario no identificado' }, { status: 401 });
  }

  const allowed = await withMssqlPool(async (pool) =>
    userHasDeleteAttachmentsPermission(pool, userId)
  );
  if (!allowed) {
    return NextResponse.json(
      {
        error:
          'No tiene permiso “Eliminar adjuntos”. Asígueselo en Administración → Usuarios.',
      },
      { status: 403 }
    );
  }

  // No borrar PDFs con flujo de firma activo/cerrado (evita romper expedientes).
  const orionBlock = await withMssqlPool(async (pool) => {
    const field = await findOrionSignatureField(pool, requestId);
    if (!field?.value_text) return null;
    const bag = parseOrionSignatureBagBag(field.value_text);
    const doc = getOrionDocumentFromBag(bag, fileId);
    const status = String(doc.status || '').toUpperCase();
    const hasFlow =
      Boolean(doc.orionDocumentId) ||
      (doc.signers?.length ?? 0) > 0 ||
      status === 'EN_PROCESO' ||
      status === 'PENDIENTE_FIRMA' ||
      status === 'FIRMADO';
    if (!hasFlow) return null;
    return { status: status || 'EN_FLUJO', bag, field };
  });

  if (orionBlock && ['EN_PROCESO', 'PENDIENTE_FIRMA', 'FIRMADO'].includes(orionBlock.status)) {
    return NextResponse.json(
      {
        error:
          'No se puede eliminar: este documento tiene un flujo de firma activo o ya firmado. Márquelo como “Solo ver” solo antes de enviarlo, o gestione el expediente desde GSS Firma.',
      },
      { status: 409 }
    );
  }

  const token = await getMicrosoftToken();
  if (!token) {
    return NextResponse.json({ error: 'No se pudo obtener token de OneDrive' }, { status: 502 });
  }

  await deleteOneDriveItem(token, fileId);

  // Limpiar fantasma Orion (borrador). Si OD ya no existía, igual se limpia el bag.
  await withMssqlPool(async (pool) => {
    const field = await findOrionSignatureField(pool, requestId);
    if (!field?.value_text || field.rfv_id == null) return;
    const bag = parseOrionSignatureBagBag(field.value_text);
    if (!bag.documents[fileId]) return;
    const doc = getOrionDocumentFromBag(bag, fileId);
    const status = String(doc.status || '').toUpperCase();
    if (['EN_PROCESO', 'PENDIENTE_FIRMA', 'FIRMADO'].includes(status)) return;
    const nextDocs = { ...bag.documents };
    delete nextDocs[fileId];
    const value = serializeOrionSignatureBagBag({ ...bag, documents: nextDocs });
    await pool
      .request()
      .input('id', sql.Int, field.rfv_id)
      .input('value', sql.NVarChar(sql.MAX), value)
      .query(`UPDATE request_form_values SET value_text = @value WHERE id = @id`);
  });

  return NextResponse.json({ ok: true, requestId, fileId });
}

export async function POST(req: Request) {
  try {
    return await handleDelete(req);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error interno';
    console.error('[delete-attachment]', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    return await handleDelete(req);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error interno';
    console.error('[delete-attachment]', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
