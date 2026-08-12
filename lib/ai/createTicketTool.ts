// Crear caso Help Desk vía API.

export interface CreateTicketInput {
  requestType: string;
  priority: string;
  companyId: number;
  categoryId: number;
  subcategoryId: number;
  activityId: number;
  departmentId: number;
  site: string;
  asunto: string;
  description: string;
  technicianId?: number | null;
  requesterId?: number | string | null;
}

export async function createHelpDeskTicket(
  input: CreateTicketInput,
): Promise<{ ok: true; id: number } | { ok: false; message: string }> {
  const asunto = input.asunto.trim();
  const description = input.description.trim();

  if (
    !input.requestType ||
    !input.priority ||
    !input.companyId ||
    !input.categoryId ||
    !input.subcategoryId ||
    !input.activityId ||
    !input.departmentId ||
    !input.site ||
    !asunto ||
    description.length < 10
  ) {
    return {
      ok: false,
      message:
        'Completa tipo, prioridad, empresa, categoría, subcategoría, actividad, departamento, sitio, asunto y descripción (≥10).',
    };
  }

  if (!input.requesterId) {
    return {
      ok: false,
      message:
        'No se pudo identificar tu usuario solicitante. El asistente ahora busca por email de sesión; recarga e intenta de nuevo.',
    };
  }

  try {
    const res = await fetch('/api/help-desk/create_ticket', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestType: input.requestType,
        priority: input.priority,
        technician: input.technicianId || null,
        category: input.categoryId,
        subcategory: input.subcategoryId,
        site: input.site,
        requester: input.requesterId,
        asunto,
        department: input.departmentId,
        activity: input.activityId,
        description,
        company: input.companyId,
      }),
    });

    const data = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      id_case?: number;
      error?: string;
      details?: string;
      message?: string;
    };

    if (!res.ok) {
      return {
        ok: false,
        message:
          data.error ||
          data.details ||
          data.message ||
          `Error ${res.status}`,
      };
    }

    const id = Number(data.id_case);
    if (!Number.isFinite(id)) {
      return { ok: false, message: 'La API no devolvió el id del caso.' };
    }
    return { ok: true, id };
  } catch (err) {
    return {
      ok: false,
      message:
        err instanceof Error ? err.message : 'Error de red al crear el caso.',
    };
  }
}
