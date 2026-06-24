/** Placeholder visible en el campo de contacto del solicitante. */
export const CONTACT_EMAIL_PLACEHOLDER = 'correo@empresa.com';

type CaseEmailFields = {
  /** c.email — mismo valor que el campo "Correo electrónico" en detalle del caso. */
  email?: string | null;
  contact_email?: string | null;
  /** Solo para ownership en SQL (Mis tickets); no usar para mostrar en UI del panel. */
  requester_email?: string | null;
};

/**
 * Correo de contacto guardado en el caso (c.email).
 * Es el que se edita en detalle y el que vincula el caso al usuario en Mis tickets
 * (CASE_CONTACT_EMAIL_SQL en requesterSql.js).
 */
export function getCaseContactEmail(raw: CaseEmailFields): string {
  const fromEmail = typeof raw.email === 'string' ? raw.email.trim() : '';
  if (fromEmail) return fromEmail;

  const fromAlias = typeof raw.contact_email === 'string' ? raw.contact_email.trim() : '';
  return fromAlias;
}

/** @deprecated Usar getCaseContactEmail */
export function resolveContactEmail(raw: CaseEmailFields): string {
  return getCaseContactEmail(raw);
}

/** Texto en listados: correo del caso o placeholder si aún no se ha asignado. */
export function getCaseContactEmailDisplay(raw: CaseEmailFields): string {
  return getCaseContactEmail(raw) || CONTACT_EMAIL_PLACEHOLDER;
}

/** Normaliza c.email en ítems de listado (mismo valor que el detalle del caso). */
export function normalizeCaseListItem<T extends CaseEmailFields>(ticket: T): T {
  const contactEmail = getCaseContactEmail(ticket);
  return {
    ...ticket,
    email: contactEmail || undefined,
  };
}

/** @deprecated Usar getCaseContactEmailDisplay */
export function getContactEmailLabel(raw: CaseEmailFields): string {
  return getCaseContactEmailDisplay(raw);
}
