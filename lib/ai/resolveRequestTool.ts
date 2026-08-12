// Resolver / cancelar / devolver solicitud general + correo al solicitante.

import { sendMessage } from '../../components/email/utils/sendMessage';

export type ResolveStatusKind = 'resolve' | 'cancel' | 'return';

export const RESOLVE_STATUS_IDS: Record<ResolveStatusKind, number> = {
  resolve: 2,
  cancel: 3,
  return: 7,
};

export interface ResolveRequestInput {
  requestId: number;
  kind: ResolveStatusKind;
  resolution: string;
  executorId: number | string;
  sendEmail?: boolean;
}

export interface RequestSnapshot {
  id: number;
  subject: string;
  category?: string;
  process?: string;
  company?: string;
  created_at?: string;
  requester_email?: string | null;
  requester?: string | null;
  status_req?: number;
  id_process_category?: number | null;
}

export async function fetchRequestSnapshot(
  requestId: number,
): Promise<RequestSnapshot | null> {
  const res = await fetch(
    `/api/requests-general/view-request?id=${requestId}`,
  );
  if (!res.ok) return null;
  const data = (await res.json()) as Record<string, unknown>;
  const id = Number(data.id);
  if (!Number.isFinite(id)) return null;
  return {
    id,
    subject: String(data.subject_request ?? data.subject ?? ''),
    category: data.category != null ? String(data.category) : undefined,
    process: data.process != null ? String(data.process) : undefined,
    company: data.company != null ? String(data.company) : undefined,
    created_at:
      data.created_at != null ? String(data.created_at) : undefined,
    requester_email:
      data.requester_email != null ? String(data.requester_email) : null,
    requester: data.requester != null ? String(data.requester) : null,
    status_req:
      data.status_req != null ? Number(data.status_req) : undefined,
    id_process_category:
      data.id_process_category != null
        ? Number(data.id_process_category)
        : null,
  };
}

export async function resolveGeneralRequest(
  input: ResolveRequestInput,
): Promise<
  | {
      ok: true;
      requestId: number;
      statusId: number;
      emailSent: boolean;
      emailSkippedReason?: string;
      subject: string;
    }
  | { ok: false; message: string }
> {
  const requestId = Number(input.requestId);
  if (!Number.isFinite(requestId) || requestId <= 0) {
    return { ok: false, message: 'Número de solicitud inválido.' };
  }
  if (input.executorId == null || String(input.executorId).trim() === '') {
    return {
      ok: false,
      message: 'No se identificó el usuario ejecutor. Recarga la sesión.',
    };
  }

  const executorId = String(input.executorId).trim();

  const statusId = RESOLVE_STATUS_IDS[input.kind];
  const resolution =
    input.kind === 'return'
      ? null
      : (input.resolution.trim() ||
        (input.kind === 'resolve' ? 'Resuelto' : 'Cancelado'));

  if (input.kind !== 'return' && (!resolution || resolution.length < 2)) {
    return { ok: false, message: 'Indica el texto de resolución.' };
  }

  const snapshot = await fetchRequestSnapshot(requestId);
  if (!snapshot) {
    return {
      ok: false,
      message: `No se encontró la solicitud #${requestId}.`,
    };
  }

  if (snapshot.status_req === 2 || snapshot.status_req === 3) {
    return {
      ok: false,
      message: `La solicitud #${requestId} ya está cerrada (estado ${snapshot.status_req}).`,
    };
  }

  try {
    const updateRes = await fetch('/api/requests-general/update-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: requestId,
        id_technical: executorId,
        status: statusId,
        resolucion: resolution,
        process_category: snapshot.id_process_category ?? null,
      }),
    });

    const updateData = (await updateRes.json().catch(() => ({}))) as {
      success?: boolean;
      error?: string;
      details?: string;
      message?: string;
    };

    if (!updateRes.ok || updateData.success === false) {
      return {
        ok: false,
        message:
          updateData.error ||
          updateData.details ||
          updateData.message ||
          `Error al actualizar (#${updateRes.status}).`,
      };
    }
  } catch (err) {
    return {
      ok: false,
      message:
        err instanceof Error
          ? err.message
          : 'Error de red al actualizar la solicitud.',
    };
  }

  let emailSent = false;
  let emailSkippedReason: string | undefined;
  const wantEmail = input.sendEmail !== false && input.kind !== 'return';

  if (wantEmail) {
    const to = snapshot.requester_email?.trim();
    if (!to) {
      emailSkippedReason =
        'La solicitud no tiene email del solicitante; el estado sí se actualizó.';
    } else {
      try {
        const statusLabel =
          input.kind === 'resolve'
            ? 'resuelta'
            : input.kind === 'cancel'
              ? 'cancelada'
              : 'actualizada';
        const title = `Actualización de la Solicitud #${requestId} - ${snapshot.subject}`;
        const table = [
          {
            'ID de la Solicitud': requestId,
            Asunto: snapshot.subject,
            Categoría: snapshot.category,
            Proceso: snapshot.process,
            Empresa: snapshot.company,
            'Fecha de Creación': snapshot.created_at
              ? new Date(snapshot.created_at).toISOString().split('T')[0]
              : 'N/A',
          },
        ];
        const outro = `
          <div style="margin-top:20px;padding:15px;border-radius:8px;background:#f8f9fa;border:1px solid #e0e0e0;">
            <h3 style="margin:0 0 10px 0;font-size:16px;">Resolución</h3>
            <p style="margin:0;white-space:pre-wrap;line-height:1.6;font-size:14px;">${escapeHtml(resolution || '')}</p>
          </div>
          <p style="margin-top:20px;">
            La solicitud #${requestId} ha sido marcada como <strong>${statusLabel}</strong>.
            Este es un mensaje automático de SynerLink.
          </p>
        `;
        await sendMessage(
          title,
          to,
          table,
          outro,
          'https://farmalogica.com.co/imagenes/logos/logo20.png',
          [],
        );
        emailSent = true;
      } catch (err) {
        emailSkippedReason =
          err instanceof Error
            ? `Estado actualizado, pero el correo falló: ${err.message}`
            : 'Estado actualizado, pero el correo falló.';
      }
    }
  }

  return {
    ok: true,
    requestId,
    statusId,
    emailSent,
    emailSkippedReason,
    subject: snapshot.subject,
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
