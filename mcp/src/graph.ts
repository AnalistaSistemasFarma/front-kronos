/**
 * Cliente MS Graph (OneDrive) de SOLO LECTURA para el MCP de Kronos.
 *
 * SynerLink/Kronos sube los adjuntos de cada solicitud/ticket a OneDrive vía
 * Microsoft Graph, usando un flujo APP-ONLY (client_credentials). Este módulo
 * REUTILIZA esas mismas credenciales (las mismas variables de entorno que ya
 * usa el front) para poder LISTAR y resolver la descarga de esos archivos
 * reales desde el MCP. No escribe ni borra nada en OneDrive.
 *
 * Variables de entorno reutilizadas del front-kronos:
 *   - MICROSOFTCLIENTID
 *   - MICROSOFTCLIENTSECRET
 *   - MICROSOFTTENANTID
 *   - MICROSOFTGRAPHUSERROUTE  (ej: https://graph.microsoft.com/v1.0/users/<id>/drive/)
 *
 * Convención de carpetas por solicitud (idéntica a la del front):
 *   - Solicitudes generales: SAPSEND/TEC/SG/Request-<id_request_general>
 *   - Tickets (help-desk):   SAPSEND/TEC/MA/Ticket-<id_case>
 *
 * Implementado con `fetch` global (Node >= 18/20); sin dependencias nuevas.
 */

/** Config de Graph leída del entorno. `null` si no está completa. */
export interface GraphConfig {
  clientId: string;
  clientSecret: string;
  tenantId: string;
  /** Base del drive, con `/` final. Ej: .../users/<id>/drive/ */
  driveRoute: string;
}

/** Metadatos de un archivo real en OneDrive. */
export interface GraphFile {
  /** driveItem id (para get_attachment). */
  id: string;
  name: string;
  size: number | null;
  mimeType: string | null;
  createdDateTime: string | null;
  lastModifiedDateTime: string | null;
  /** URL de descarga directa temporal (sin auth); puede faltar. */
  downloadUrl: string | null;
  webUrl: string | null;
}

/** Lee y valida la config de Graph del entorno. Devuelve null si falta algo. */
export function loadGraphConfig(env: NodeJS.ProcessEnv = process.env): GraphConfig | null {
  const clientId = env.MICROSOFTCLIENTID?.trim();
  const clientSecret = env.MICROSOFTCLIENTSECRET?.trim();
  const tenantId = env.MICROSOFTTENANTID?.trim();
  let driveRoute = env.MICROSOFTGRAPHUSERROUTE?.trim();

  if (!clientId || !clientSecret || !tenantId || !driveRoute) {
    return null;
  }
  // Placeholders del .env.example ("your-client-id"): tratarlos como ausentes.
  if (clientId.startsWith('your-') || tenantId.startsWith('your-')) {
    return null;
  }
  if (!driveRoute.endsWith('/')) driveRoute += '/';

  return { clientId, clientSecret, tenantId, driveRoute };
}

/** Cliente Graph de solo lectura con token app-only cacheado. */
export class GraphClient {
  private cfg: GraphConfig;
  private token: string | null = null;
  private tokenExpiresAt = 0;

  constructor(cfg: GraphConfig) {
    this.cfg = cfg;
  }

  /** Token app-only (client_credentials). Cacheado hasta poco antes de expirar. */
  private async getToken(): Promise<string> {
    const now = Date.now();
    if (this.token && now < this.tokenExpiresAt - 60_000) {
      return this.token;
    }
    const url = `https://login.microsoftonline.com/${this.cfg.tenantId}/oauth2/v2.0/token`;
    const body = new URLSearchParams({
      client_id: this.cfg.clientId,
      client_secret: this.cfg.clientSecret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    });
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!resp.ok) {
      const detail = await safeText(resp);
      throw new Error(`No se pudo obtener token de MS Graph (${resp.status}): ${detail}`);
    }
    const data = (await resp.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token) {
      throw new Error('Respuesta de token de MS Graph sin access_token.');
    }
    this.token = data.access_token;
    this.tokenExpiresAt = now + (data.expires_in ?? 3600) * 1000;
    return this.token;
  }

  private async authHeaders(): Promise<Record<string, string>> {
    return { Authorization: `Bearer ${await this.getToken()}` };
  }

  /**
   * Lista los ARCHIVOS reales dentro de una carpeta relativa a la raíz del
   * drive (ej: `SAPSEND/TEC/SG/Request-104`). Devuelve solo los items que son
   * archivo (excluye subcarpetas). Si la carpeta no existe (404) devuelve `[]`.
   */
  async listFolderFiles(folderPath: string): Promise<GraphFile[]> {
    const encoded = encodePath(folderPath);
    // OJO: NO usar $select. La propiedad computada @microsoft.graph.downloadUrl
    // solo se incluye cuando NO hay proyección $select (Graph la omite si se
    // selecciona explícitamente). Traemos el item completo y lo mapeamos.
    const url = `${this.cfg.driveRoute}root:/${encoded}:/children?$top=200`;
    const files: GraphFile[] = [];
    let next: string | null = url;
    let guard = 0;
    while (next && guard < 20) {
      guard++;
      const resp: Response = await fetch(next, { headers: await this.authHeaders() });
      if (resp.status === 404) return [];
      if (!resp.ok) {
        const detail = await safeText(resp);
        throw new Error(`Error listando carpeta OneDrive (${resp.status}): ${detail}`);
      }
      const data = (await resp.json()) as {
        value?: GraphRawItem[];
        '@odata.nextLink'?: string;
      };
      for (const item of data.value ?? []) {
        if (item.file) files.push(toGraphFile(item));
      }
      next = data['@odata.nextLink'] ?? null;
    }
    return files;
  }

  /** Obtiene los metadatos (incl. downloadUrl) de un driveItem por su id. */
  async getItemById(itemId: string): Promise<GraphFile | null> {
    // Sin $select para que Graph incluya @microsoft.graph.downloadUrl.
    const url = `${this.cfg.driveRoute}items/${encodeURIComponent(itemId)}`;
    const resp = await fetch(url, { headers: await this.authHeaders() });
    if (resp.status === 404) return null;
    if (!resp.ok) {
      const detail = await safeText(resp);
      throw new Error(`Error obteniendo archivo OneDrive (${resp.status}): ${detail}`);
    }
    const item = (await resp.json()) as GraphRawItem;
    if (!item.file) return null;
    return toGraphFile(item);
  }

  /**
   * Descarga el contenido de un driveItem como Buffer. Se usa solo para
   * archivos pequeños (el llamador impone el límite de tamaño).
   */
  async downloadContent(itemId: string): Promise<Buffer> {
    const url = `${this.cfg.driveRoute}items/${encodeURIComponent(itemId)}/content`;
    const resp = await fetch(url, { headers: await this.authHeaders() });
    if (!resp.ok) {
      const detail = await safeText(resp);
      throw new Error(`Error descargando contenido OneDrive (${resp.status}): ${detail}`);
    }
    const arr = await resp.arrayBuffer();
    return Buffer.from(arr);
  }
}

interface GraphRawItem {
  id: string;
  name?: string;
  size?: number;
  file?: { mimeType?: string };
  createdDateTime?: string;
  lastModifiedDateTime?: string;
  webUrl?: string;
  '@microsoft.graph.downloadUrl'?: string;
}

function toGraphFile(item: GraphRawItem): GraphFile {
  return {
    id: item.id,
    name: item.name ?? '',
    size: typeof item.size === 'number' ? item.size : null,
    mimeType: item.file?.mimeType ?? null,
    createdDateTime: item.createdDateTime ?? null,
    lastModifiedDateTime: item.lastModifiedDateTime ?? null,
    downloadUrl: item['@microsoft.graph.downloadUrl'] ?? null,
    webUrl: item.webUrl ?? null,
  };
}

/** Codifica cada segmento de una ruta OneDrive dejando los `/` intactos. */
function encodePath(path: string): string {
  return path
    .split('/')
    .filter((s) => s.length > 0)
    .map((s) => encodeURIComponent(s))
    .join('/');
}

async function safeText(resp: Response): Promise<string> {
  try {
    const t = await resp.text();
    return t.slice(0, 300);
  } catch {
    return '(sin detalle)';
  }
}

/** Ruta de carpeta de una solicitud general en OneDrive. */
export function requestFolderPath(requestId: number): string {
  return `SAPSEND/TEC/SG/Request-${requestId}`;
}

/** Ruta de carpeta de un ticket (help-desk) en OneDrive. */
export function ticketFolderPath(caseId: number): string {
  return `SAPSEND/TEC/MA/Ticket-${caseId}`;
}
