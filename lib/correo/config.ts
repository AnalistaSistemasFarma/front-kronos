/**
 * Configuración del módulo Correo (solo servidor; ninguna de estas variables va al navegador).
 *
 * Decisión de Nicolás Rivera (2026-10-15 10:26): se usa la app de Microsoft Graph de
 * APLICACIÓN (client credentials) que ya usa el conector de SharePoint y correo de
 * GSS, no una app delegada nueva. Por eso el control clave es que el buzón SIEMPRE
 * sale de la sesión (ver mailboxForSession en lib/correo/graph.ts).
 *
 *   CORREO_MODO               off (por defecto) | mock | graph
 *                               off   → el módulo muestra «en preparación» y no llama a Microsoft.
 *                               mock  → buzón SIMULADO (pruebas y CI).
 *                               graph → el buzón real de la persona, con la app del inquilino.
 *   CORREO_INQUILINOS          claves de los inquilinos habilitados, separadas por coma (p. ej. «gss»).
 *   Por cada clave <K> (en mayúsculas):
 *   CORREO_<K>_TENANT_ID       id del inquilino de Entra.
 *   CORREO_<K>_CLIENT_ID       id de la app (para GSS: la del conector mcp-sharepoint-gss).
 *   CORREO_<K>_CLIENT_SECRET   su secreto (solo en el .env del servidor).
 *   CORREO_<K>_DOMINIOS        dominios de correo de ese inquilino (coma). Un usuario cuyo correo no
 *                              sea de un inquilino habilitado ve «Correo disponible próximamente».
 *   CORREO_ENVIO_HABILITADO    true (defecto): responder desde SynerLink (Mail.Send).
 *   CORREO_ETIQUETAR_HABILITADO true (defecto): categoría «SynerLink #N» en Outlook (Mail.ReadWrite).
 *   CORREO_SYNC_HABILITADO     false (defecto): tarea de fondo que pasa a notas los correos nuevos
 *                              de los hilos vinculados. Se enciende solo con aprobación.
 *   CORREO_AGENTE_HABILITADO   false (defecto): «Consultar a un agente» (compartir un hilo con un
 *                              agente del chat). Apagado: el botón no aparece, las rutas
 *                              /api/correo/agente/** responden 403 y kronos-mcp NO registra las
 *                              herramientas correo_*. Se enciende solo con la aprobación de Gobierno IA.
 */
export type CorreoModo = 'off' | 'mock' | 'graph';

export interface Inquilino {
  clave: string;
  tenantId: string;
  clientId: string;
  clientSecret: string;
  dominios: string[];
}

export interface CorreoConfig {
  modo: CorreoModo;
  inquilinos: Inquilino[];
  envioHabilitado: boolean;
  etiquetarHabilitado: boolean;
  syncHabilitado: boolean;
  /** «Consultar a un agente» (CORREO_AGENTE_HABILITADO, apagado por defecto). */
  agenteHabilitado: boolean;
}

type Env = Record<string, string | undefined>;

function lista(v: string | undefined): string[] {
  return String(v ?? '')
    .split(/[,\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

const bool = (v: string | undefined, def: boolean) => {
  const s = String(v ?? '').trim().toLowerCase();
  return s === '' ? def : s === 'true';
};

const CLAVE_RE = /^[a-z0-9]{2,20}$/;
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function readCorreoConfig(env: Env = process.env): CorreoConfig {
  const raw = String(env.CORREO_MODO ?? 'off').trim().toLowerCase();
  const modo: CorreoModo = raw === 'mock' || raw === 'graph' ? raw : 'off';
  const inquilinos: Inquilino[] = [];
  for (const clave of lista(env.CORREO_INQUILINOS).filter((c) => CLAVE_RE.test(c))) {
    const K = clave.toUpperCase();
    inquilinos.push({
      clave,
      tenantId: String(env[`CORREO_${K}_TENANT_ID`] ?? '').trim(),
      clientId: String(env[`CORREO_${K}_CLIENT_ID`] ?? '').trim(),
      clientSecret: String(env[`CORREO_${K}_CLIENT_SECRET`] ?? '').trim(),
      dominios: lista(env[`CORREO_${K}_DOMINIOS`]).map((d) => d.replace(/^@/, '')),
    });
  }
  return {
    modo,
    inquilinos,
    envioHabilitado: bool(env.CORREO_ENVIO_HABILITADO, true),
    etiquetarHabilitado: bool(env.CORREO_ETIQUETAR_HABILITADO, true),
    syncHabilitado: bool(env.CORREO_SYNC_HABILITADO, false),
    agenteHabilitado: bool(env.CORREO_AGENTE_HABILITADO, false),
  };
}

/** ¿Está encendido «Consultar a un agente» en este ambiente? (se lee en cada llamada). */
export function agenteCorreoHabilitado(env: Env = process.env): boolean {
  return bool(env.CORREO_AGENTE_HABILITADO, false);
}

/** Qué le falta a un inquilino (nombres de variables, nunca valores). */
export function faltantesInquilino(i: Inquilino): string[] {
  const K = i.clave.toUpperCase();
  const f: string[] = [];
  if (!GUID_RE.test(i.tenantId)) f.push(`CORREO_${K}_TENANT_ID`);
  if (!GUID_RE.test(i.clientId)) f.push(`CORREO_${K}_CLIENT_ID`);
  if (!i.clientSecret) f.push(`CORREO_${K}_CLIENT_SECRET`);
  if (i.dominios.length === 0) f.push(`CORREO_${K}_DOMINIOS`);
  return f;
}

/** Inquilino completo que atiende el dominio del correo, o null. */
export function inquilinoDeCorreo(cfg: CorreoConfig, email: string): Inquilino | null {
  const dominio = String(email ?? '').trim().toLowerCase().split('@')[1] ?? '';
  if (!dominio) return null;
  return cfg.inquilinos.find((i) => i.dominios.includes(dominio) && faltantesInquilino(i).length === 0) ?? null;
}
