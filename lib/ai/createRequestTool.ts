// Crear solicitud general vía API (tool del asistente).

export interface CreateRequestInput {
  companyId: number;
  processId: number;
  subject: string;
  description: string;
  categoryId?: number | null;
  createdBy?: number | string | null;
  url?: string | null;
}

export interface CreateRequestResult {
  ok: true;
  id: number;
  message?: string;
}

export interface CreateRequestError {
  ok: false;
  message: string;
}

/**
 * Resuelve el id de dbo.[user] (cuid string de Prisma/NextAuth).
 * `id_executor_final` tiene FK a [user].id — hay que enviar el mismo string, sin Number().
 */
export async function resolveRequesterUserId(
  userName?: string | null,
  email?: string | null,
  sessionUserId?: string | null,
): Promise<string | null> {
  // 1) API get-user-id (mismo que view-request)
  try {
    const params = new URLSearchParams();
    if (userName?.trim()) params.set('userName', userName.trim());
    if (email?.trim()) params.set('email', email.trim());
    const res = await fetch(`/api/requests-general/get-user-id?${params}`);
    if (res.ok) {
      const data = (await res.json()) as { success?: boolean; userId?: string | number };
      if (data.success && data.userId != null && String(data.userId).trim() !== '') {
        return String(data.userId).trim();
      }
    }
  } catch {
    // continuar
  }

  // 2) session.user.id (Prisma User.id === dbo.[user].id)
  if (sessionUserId && String(sessionUserId).trim()) {
    return String(sessionUserId).trim();
  }

  // 3) global-store
  if (typeof window !== 'undefined') {
    try {
      const raw = localStorage.getItem('global-store');
      if (raw) {
        const parsed = JSON.parse(raw) as {
          state?: { idUser?: string | number };
        };
        const id = parsed?.state?.idUser;
        if (id != null && String(id).trim() !== '') {
          return String(id).trim();
        }
      }
    } catch {
      // ignore
    }
  }

  return null;
}

export async function createGeneralRequest(
  input: CreateRequestInput,
): Promise<CreateRequestResult | CreateRequestError> {
  const subject = input.subject.trim();
  const descripcion = input.description.trim();
  if (!input.companyId || !input.processId || !subject || !descripcion) {
    return {
      ok: false,
      message: 'Faltan empresa, proceso, asunto o descripción.',
    };
  }
  if (descripcion.length < 10) {
    return {
      ok: false,
      message: 'La descripción debe tener al menos 10 caracteres.',
    };
  }

  try {
    const createdby =
      input.createdBy == null || input.createdBy === ''
        ? null
        : String(input.createdBy);

    const res = await fetch('/api/requests-general/create-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        company: input.companyId,
        subject,
        descripcion,
        category: input.categoryId ?? undefined,
        process: input.processId,
        createdby,
        url: input.url ?? '',
        formValues: [],
      }),
    });

    const data = (await res.json().catch(() => ({}))) as {
      message?: string;
      id_request?: number;
      error?: string;
    };

    if (!res.ok) {
      return {
        ok: false,
        message:
          data.message ||
          data.error ||
          `No se pudo crear la solicitud (${res.status}).`,
      };
    }

    const id = Number(data.id_request);
    if (!Number.isFinite(id)) {
      return {
        ok: false,
        message: 'La API no devolvió el id de la solicitud creada.',
      };
    }

    return {
      ok: true,
      id,
      message: data.message,
    };
  } catch (err) {
    return {
      ok: false,
      message:
        err instanceof Error
          ? err.message
          : 'Error de red al crear la solicitud.',
    };
  }
}
