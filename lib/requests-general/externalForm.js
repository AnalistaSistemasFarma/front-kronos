// Utilidades PURAS del formulario externo (acceso sin login). Sin dependencias de BD
// para poder testearlas y reutilizarlas desde el submit público y el GET público.

/** id del usuario de sistema "Portal Externo" (SIN login). Usado como createdby. */
export const PORTAL_EXTERNO_USER_ID = 'cext000000000000000000000';

/** Tope de tamaño del payload del submit público (anti-abuso básico). */
export const MAX_EXTERNAL_PAYLOAD_BYTES = 64 * 1024; // 64 KB

/** Máximo de campos aceptados en un submit público (anti-abuso básico). */
export const MAX_EXTERNAL_FIELDS = 200;

/**
 * Sanea texto libre: quita caracteres de control (deja saltos de línea y tabs),
 * recorta espacios y limita longitud. Nunca devuelve null.
 */
export function sanitizeText(value, maxLen = 1000) {
  if (value == null) return '';
  const raw = String(value);
  let s = '';
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    // Deja \t (9) y \n (10); descarta el resto de caracteres de control (0-31, 127).
    if (c === 9 || c === 10 || (c >= 32 && c !== 127)) s += raw[i];
  }
  s = s.trim();
  if (s.length > maxLen) s = s.slice(0, maxLen);
  return s;
}

/** Asunto server-side para una solicitud externa (no lo controla el cliente). */
export function buildExternalSubject(processName) {
  const name = sanitizeText(processName || 'Solicitud', 200);
  return sanitizeText(`Solicitud externa · ${name}`, 255);
}

/**
 * Descripción server-side a partir de las líneas "etiqueta: valor" ya resueltas.
 * Garantiza al menos 10 caracteres (requisito de requests_general) y tope de 1000.
 * @param {string} processName
 * @param {{label: string, value: string}[]} lines
 */
export function buildExternalDescription(processName, lines) {
  const name = sanitizeText(processName || 'Solicitud', 200);
  const header = `Solicitud recibida por formulario externo del proceso "${name}".`;
  const bodyLines = (Array.isArray(lines) ? lines : [])
    .filter((l) => l && sanitizeText(l.value, 500))
    .map((l) => `- ${sanitizeText(l.label, 120)}: ${sanitizeText(l.value, 500)}`);
  let text = [header, ...bodyLines].join('\n');
  text = sanitizeText(text, 1000);
  if (text.length < 10) {
    text = sanitizeText(`${header} Sin datos adicionales.`, 1000);
  }
  return text;
}
