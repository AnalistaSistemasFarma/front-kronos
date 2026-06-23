/** Placeholder visible en el campo de contacto del solicitante. */
export const CONTACT_EMAIL_PLACEHOLDER = 'correo@empresa.com';

/**
 * Correo de contacto explícito para notificaciones (c.email).
 * No reutiliza el correo inferido del solicitante legacy (requester_email).
 */
export function resolveContactEmail(raw: {
  email?: string | null;
  requester_email?: string | null;
}): string {
  const stored = typeof raw.email === 'string' ? raw.email.trim() : '';
  if (!stored) return '';

  const inferred =
    typeof raw.requester_email === 'string' ? raw.requester_email.trim() : '';

  if (inferred && stored.toLowerCase() === inferred.toLowerCase()) {
    return '';
  }

  return stored;
}
