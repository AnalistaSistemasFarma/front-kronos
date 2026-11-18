/**
 * Motor «editor» de la tarea Plantilla de documento: llena el HTML de la plantilla con los
 * valores de la solicitud. PURO.
 *
 * Cada valor se ESCAPA (nadie puede inyectar HTML desde el formulario); la única excepción
 * es la tabla que arma fields.ts para los campos tipo tabla, que ya viene escapada celda a celda.
 */
import { HTML_TOKEN_RE, type DocResolvedValue } from './fields';

const MENTION_RE = /<span\b[^>]*\bdata-field="((?:f|sys):[a-z0-9_]{1,60})"[^>]*>[\s\S]*?<\/span>/gi;

/** Menciones del editor (span con data-field) → tokens «{{CAMPO_FLUJO:clave}}» (formato guardado). */
export function mentionsToTokens(html: string): string {
  return String(html ?? '').replace(MENTION_RE, (_, key: string) => `{{CAMPO_FLUJO:${key.toLowerCase()}}}`);
}

export interface FillHtmlResult {
  html: string;
  /** Claves de marcas que no tenían valor conocido (se dejaron vacías). */
  unknown: string[];
}

export function fillHtml(template: string, values: Readonly<Record<string, DocResolvedValue>>): FillHtmlResult {
  const unknown = new Set<string>();
  const put = (rawKey: string) => {
    const key = rawKey.toLowerCase();
    const v = values[key];
    if (!v) {
      unknown.add(key);
      return '';
    }
    return v.html;
  };
  const html = mentionsToTokens(template).replace(HTML_TOKEN_RE, (_, key: string) => put(key));
  return { html, unknown: [...unknown] };
}
