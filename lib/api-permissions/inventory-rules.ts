/**
 * PERMISOS API — «Lo que tiene hoy»: reglas PURAS (sin base ni `server-only`;
 * las usa también la pantalla) para comparar el INVENTARIO real de un agente
 * (lo que escanea el recolector: agent_inventory / agent_inventory_mcp) con lo
 * AUTORIZADO en su cliente de API (empresas y permisos).
 *
 * Clasificación de conectores (MCP configurados en el agente):
 *  - «synerlink»: el MCP de Kronos (kronos-synerlink, synerlink-solicitud-*). Lo que
 *    puede hacer lo controla esta pantalla (permisos del cliente).
 *  - «gss»: servidores de GSS (sapbo-*, sap-*, sapsend-*, sharepoint-*). Aún no se
 *    controlan desde aquí (fase 2: API SAP).
 *  - «local»: corre en el equipo del agente (stdio y todo lo demás). Solo se ve.
 */

export type ConnectorClass = 'synerlink' | 'gss' | 'local';

export const CONNECTOR_CLASSES: readonly ConnectorClass[] = ['synerlink', 'gss', 'local'];

export const CONNECTOR_CLASS_LABELS: Record<ConnectorClass, string> = {
  synerlink: 'Controlado por SynerLink',
  gss: 'Servidor GSS, aún no controlado desde aquí',
  local: 'Local en el equipo del agente, solo visible',
};

/** Días a partir de los cuales el último escaneo se considera viejo. */
export const STALE_SCAN_DAYS = 7;

const SYNERLINK_CONNECTOR = /^(kronos-synerlink$|synerlink-solicitud)/;
const GSS_CONNECTOR = /^(sapbo|sap-|sapsend|sharepoint)/;

export function classifyConnector(connector: { name: string; transport?: string | null }): ConnectorClass {
  const name = connector.name.trim().toLowerCase();
  if (SYNERLINK_CONNECTOR.test(name)) return 'synerlink';
  if (GSS_CONNECTOR.test(name)) return 'gss';
  return 'local';
}

/**
 * Destino de un conector SIN credenciales: solo esquema + host (+ puerto) de un
 * HTTP/SSE. Para stdio (un ejecutable del equipo) o algo que no sea una URL
 * limpia no se devuelve nada.
 */
export function safeConnectorTarget(target: string | null | undefined, transport: string | null | undefined): string | null {
  if (!target || (transport !== 'http' && transport !== 'sse')) return null;
  const raw = target.trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (!/^[a-z0-9.-]+$/i.test(url.hostname) && !/^\[[0-9a-f:]+\]$/i.test(url.hostname)) return null;
  return `${url.protocol}//${url.hostname}${url.port ? `:${url.port}` : ''}`;
}

/* ─────────────────────────────── Tipos de la vista ─────────────────────────────── */

export interface InventoryConnector {
  name: string;
  transport: string;
  /** Solo esquema + host (nunca la ruta ni credenciales). */
  host: string | null;
  company: string | null;
  access: string;
  auth: string;
  writeTools: string[];
  classification: ConnectorClass;
}

export interface InventoryScan {
  scannedAt: string;
  kind: string;
  host: string;
  model: string | null;
  serviceStatus: string | null;
  execMode: string | null;
  execRequiresApproval: boolean | null;
  allowCount: number;
  denyCount: number;
  deny: string[];
  skillsCount: number;
  scanError: string | null;
  connectors: InventoryConnector[];
}

export interface AgentInventoryView {
  agent: { code: string; name: string; active: boolean };
  /** null = el agente nunca se ha escaneado. */
  scan: InventoryScan | null;
  companies: { id: number; name: string; isPrimary: boolean }[];
  bridge: { companyId: number; companyName: string; enabled: boolean; profiles: { key: string; label: string }[] | null; reason: string | null }[];
  governance: {
    directorName: string | null;
    directorEmail: string | null;
    privilegeTemplate: string | null;
    privilegeAppliedOn: string | null;
    notes: string | null;
    updatedBy: string | null;
    updatedAt: string | null;
  } | null;
}

/* ─────────────────────────────── Lectura del JSON guardado ─────────────────────────────── */

function parseJson(raw: string | null | undefined): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** tools_json = {"allow": [...], "deny": [...]}. */
export function summarizeToolRules(raw: string | null | undefined): { allowCount: number; denyCount: number; deny: string[] } {
  const data = parseJson(raw);
  const obj = data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
  const allow = strings(obj.allow);
  const deny = strings(obj.deny);
  return { allowCount: allow.length, denyCount: deny.length, deny: deny.slice(0, 100) };
}

/** skills_json = ["...", ...]. */
export function countSkills(raw: string | null | undefined): number {
  return strings(parseJson(raw)).length;
}

export function splitWriteTools(raw: string | null | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

/* ─────────────────────────────── Alertas ─────────────────────────────── */

export type InventoryAlertSeverity = 'alta' | 'media' | 'info';

export interface InventoryAlert {
  code:
    | 'sin-escaneo'
    | 'error-escaneo'
    | 'escaneo-viejo'
    | 'synerlink-sin-cliente'
    | 'synerlink-sin-permisos'
    | 'permisos-sin-conector'
    | 'sin-aprobacion'
    | 'conector-escritura'
    | 'empresa-no-autorizada'
    | 'empresa-sin-agente';
  severity: InventoryAlertSeverity;
  message: string;
}

/** Lo autorizado en el cliente (lo guardado o lo que está editando la pantalla). */
export interface AuthorizedClient {
  /** false = el cliente aún no se ha guardado (o no existe). */
  saved: boolean;
  allCompanies: boolean;
  companyIds: number[];
  permissionCodes: string[];
}

const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');

const SEVERITY_ORDER: Record<InventoryAlertSeverity, number> = { alta: 0, media: 1, info: 2 };

/**
 * Compara inventario y autorización. `companyNames` = catálogo de empresas
 * (id → nombre) para nombrar las del cliente en los mensajes.
 */
export function inventoryAlerts(
  view: Pick<AgentInventoryView, 'scan' | 'companies'>,
  client: AuthorizedClient | null,
  companyNames: ReadonlyMap<number, string>,
  now: Date = new Date()
): InventoryAlert[] {
  const alerts: InventoryAlert[] = [];
  const add = (code: InventoryAlert['code'], severity: InventoryAlertSeverity, message: string) =>
    alerts.push({ code, severity, message });
  const hasPermissions = (client?.permissionCodes.length ?? 0) > 0;
  const scan = view.scan;

  if (!scan) {
    add('sin-escaneo', 'media', 'El agente no tiene escaneos: no se sabe qué conectores tiene hoy.');
  } else {
    if (scan.scanError) add('error-escaneo', 'media', 'El último escaneo no pudo leer al agente completo.');
    const ageDays = (now.getTime() - new Date(scan.scannedAt).getTime()) / 86_400_000;
    if (ageDays > STALE_SCAN_DAYS) {
      add('escaneo-viejo', 'media', `El último escaneo tiene ${Math.floor(ageDays)} días: lo que se muestra puede haber cambiado.`);
    }

    const synerlink = scan.connectors.filter((c) => c.classification === 'synerlink');
    if (synerlink.length > 0 && (!client || !client.saved)) {
      add('synerlink-sin-cliente', 'alta', 'Tiene el conector de SynerLink pero no tiene cliente de API guardado: hoy usa una llave del archivo (o ninguna).');
    } else if (synerlink.length > 0 && !hasPermissions) {
      add('synerlink-sin-permisos', 'alta', 'Tiene el conector de SynerLink pero el cliente no tiene permisos marcados: con la llave de la base no verá ninguna herramienta.');
    }
    if (synerlink.length === 0 && hasPermissions) {
      add('permisos-sin-conector', 'media', 'El cliente tiene permisos marcados, pero el agente no tiene el conector de SynerLink: no los usará hasta que se lo configuren.');
    }

    if (scan.execRequiresApproval === false || scan.execMode === 'sin-aprobacion') {
      add('sin-aprobacion', 'alta', 'Ejecuta comandos del sistema sin pedir aprobación.');
    }
    for (const c of scan.connectors) {
      if (c.access === 'escritura') {
        const tools = c.writeTools.length ? `: ${c.writeTools.slice(0, 5).join(', ')}${c.writeTools.length > 5 ? '…' : ''}` : '';
        add('conector-escritura', c.classification === 'synerlink' ? 'info' : 'media', `El conector «${c.name}» puede escribir${tools}.`);
      }
    }
  }

  // Empresas: las del agente en SynerLink (agent_company) frente a las autorizadas del cliente.
  if (client && !client.allCompanies) {
    const authorized = new Set(client.companyIds);
    for (const company of view.companies) {
      if (!authorized.has(company.id)) {
        add('empresa-no-autorizada', 'info', `El agente trabaja en «${company.name}», que no está entre las empresas autorizadas del cliente.`);
      }
    }
    const agentCompanies = new Set(view.companies.map((c) => c.id));
    for (const id of client.companyIds) {
      if (!agentCompanies.has(id)) {
        add('empresa-sin-agente', 'info', `El cliente autoriza «${companyNames.get(id) ?? `empresa ${id}`}», pero el agente no está asignado a esa empresa.`);
      }
    }
    // Conectores con empresa (sapbo-<empresa>, sharepoint-<empresa>…) fuera de lo autorizado.
    const authorizedNames = client.companyIds.map((id) => normalize(companyNames.get(id) ?? ''));
    const seen = new Set<string>();
    for (const c of scan?.connectors ?? []) {
      if (!c.company || c.classification === 'local') continue;
      const n = normalize(c.company);
      if (!n || seen.has(n)) continue;
      seen.add(n);
      const covered = authorizedNames.some((a) => a && (a === n || a.includes(n) || n.includes(a)));
      if (!covered) {
        add('empresa-no-autorizada', 'info', `El conector «${c.name}» es de «${c.company}», que no está entre las empresas autorizadas del cliente.`);
      }
    }
  }

  return alerts.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}
