/**
 * Validación de destinos de redirección tras el login (OWASP H-05, redirección abierta).
 *
 * Solo se aceptan rutas relativas del mismo sitio. Se rechaza todo lo que un
 * navegador pueda interpretar como otro host:
 *   - `//evil.example` (URL relativa al protocolo);
 *   - `/\evil.example`: el navegador cambia `\` por `/` y queda `//evil.example`;
 *   - tabuladores, saltos de línea y otros caracteres de control, que el
 *     analizador de URL elimina (`/\t/evil.example` → `//evil.example`);
 *   - esquemas (`https:`, `javascript:`) y URL absolutas a otro host;
 *   - las mismas trampas codificadas (`/%5Cevil`, `/%2F/evil`).
 */

// Origen ficticio para resolver rutas relativas sin depender del navegador.
const PROBE_ORIGIN = 'https://synerlink.invalid';

/** true si `value` es una ruta relativa segura del mismo sitio (empieza con una sola «/»). */
export function isSafeRelativePath(value: string | null | undefined): value is string {
  if (typeof value !== 'string' || value.length === 0) return false;
  if (!isSafeRaw(value)) return false;

  // Las mismas trampas codificadas (`/%5C`, `/%2F/`, `/%09/`). Un espacio codificado
  // (`%20`) en la consulta sí es válido.
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return false;
  }
  if (decoded !== value && !isSafeRaw(decoded)) return false;

  // Comprobación final: resuelta contra un origen fijo, debe seguir en ese origen.
  try {
    return new URL(value, PROBE_ORIGIN).origin === PROBE_ORIGIN;
  } catch {
    return false;
  }
}

function isSafeRaw(value: string): boolean {
  if (!value.startsWith('/')) return false;
  if (value.startsWith('//')) return false;
  if (value.includes('\\')) return false;
  // Controles C0 y DEL: el analizador de URL quita tabuladores y saltos de línea.
  if (/[\x00-\x1f\x7f]/.test(value)) return false;
  return true;
}

/**
 * Callback `redirect` de NextAuth. Igual que el de fábrica (ruta relativa → baseUrl + ruta;
 * URL del mismo origen → se respeta; lo demás → baseUrl), pero con la validación estricta.
 */
export function resolveAuthRedirect(url: string, baseUrl: string): string {
  const base = baseUrl.replace(/\/$/, '');
  if (isSafeRelativePath(url)) return `${base}${url}`;

  try {
    const target = new URL(url);
    const origin = new URL(baseUrl).origin;
    const rest = `${target.pathname}${target.search}${target.hash}`;
    if (target.origin === origin && isSafeRelativePath(rest)) return target.toString();
  } catch {
    /* URL inválida */
  }
  return baseUrl;
}
