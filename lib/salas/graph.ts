import 'server-only';
import type { GraphCredenciales } from './config';
import { ZONA_GRAPH, partesGraph, rangoDias } from './fechas';

/**
 * Cliente mínimo de Microsoft Graph para el módulo de Salas (client
 * credentials, SOLO servidor). Las credenciales nunca se registran ni salen al
 * navegador. Los buzones que se consultan los arma el servidor: el de una sala
 * (de SALAS_ROOMS) o el de la sesión de SynerLink (organizador).
 */
const GRAPH = 'https://graph.microsoft.com/v1.0';
const TIMEOUT_MS = 20_000;

export class ErrorGraph extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = 'ErrorGraph';
  }
}

interface Token {
  valor: string;
  expira: number;
}
let token: Token | null = null;

async function obtenerToken(cred: GraphCredenciales): Promise<string> {
  if (token && token.expira > Date.now() + 60_000) return token.valor;
  const cuerpo = new URLSearchParams({
    client_id: cred.clientId,
    client_secret: cred.clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });
  const res = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(cred.tenantId)}/oauth2/v2.0/token`,
    { method: 'POST', body: cuerpo, signal: AbortSignal.timeout(TIMEOUT_MS), cache: 'no-store' }
  );
  if (!res.ok) throw new ErrorGraph('No se pudo autenticar con Microsoft 365.', 502);
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new ErrorGraph('No se pudo autenticar con Microsoft 365.', 502);
  token = { valor: json.access_token, expira: Date.now() + (json.expires_in ?? 3000) * 1000 };
  return token.valor;
}

function rutaBuzon(buzon: string): string {
  return `${GRAPH}/users/${encodeURIComponent(buzon.trim().toLowerCase())}`;
}

async function llamar(
  cred: GraphCredenciales,
  url: string,
  init: { method?: string; body?: unknown } = {}
): Promise<Response> {
  const u = new URL(url);
  if (u.protocol !== 'https:' || u.host !== 'graph.microsoft.com') {
    throw new ErrorGraph('URL de Graph no permitida.', 500);
  }
  const t = await obtenerToken(cred);
  return fetch(url, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${t}`,
      'Content-Type': 'application/json',
      Prefer: `outlook.timezone="${ZONA_GRAPH}"`,
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: 'no-store',
  });
}

async function errorDe(res: Response, contexto: string): Promise<ErrorGraph> {
  let detalle = '';
  try {
    const j = (await res.json()) as { error?: { code?: string } };
    detalle = j.error?.code ? ` (${j.error.code})` : '';
  } catch {
    /* sin cuerpo */
  }
  return new ErrorGraph(`${contexto}: Microsoft 365 respondió ${res.status}${detalle}.`, res.status === 404 ? 404 : 502);
}

/** Evento de calendario tal como lo devuelve Graph (campos que usamos). */
export interface EventoGraph {
  id: string;
  iCalUId?: string;
  subject?: string | null;
  sensitivity?: string;
  isCancelled?: boolean;
  showAs?: string;
  type?: string;
  seriesMasterId?: string | null;
  start: { dateTime: string };
  end: { dateTime: string };
  organizer?: { emailAddress?: { name?: string; address?: string } };
  attendees?: Array<{ type?: string; emailAddress?: { address?: string }; status?: { response?: string } }>;
}

const CAMPOS =
  'id,iCalUId,subject,sensitivity,isCancelled,showAs,type,seriesMasterId,start,end,organizer,attendees';

/** calendarView de un buzón para uno o varios días completos (offset -05:00), con paginación. */
export async function calendarView(
  cred: GraphCredenciales,
  buzon: string,
  desde: string,
  hasta: string = desde
): Promise<EventoGraph[]> {
  const { inicio, fin } = rangoDias(desde, hasta);
  const params = new URLSearchParams({
    startDateTime: inicio,
    endDateTime: fin,
    $select: CAMPOS,
    $orderby: 'start/dateTime',
    $top: '200',
  });
  let url: string | null = `${rutaBuzon(buzon)}/calendarView?${params.toString()}`;
  const eventos: EventoGraph[] = [];
  for (let pagina = 0; url && pagina < 30; pagina++) {
    const res = await llamar(cred, url);
    if (!res.ok) throw await errorDe(res, 'No se pudo leer el calendario');
    const json = (await res.json()) as { value?: EventoGraph[]; '@odata.nextLink'?: string };
    eventos.push(...(json.value ?? []));
    url = json['@odata.nextLink'] ?? null;
  }
  return eventos;
}

export async function crearEvento(
  cred: GraphCredenciales,
  organizador: string,
  cuerpo: Record<string, unknown>
): Promise<EventoGraph> {
  const res = await llamar(cred, `${rutaBuzon(organizador)}/events`, { method: 'POST', body: cuerpo });
  if (!res.ok) throw await errorDe(res, 'No se pudo crear la reserva');
  return (await res.json()) as EventoGraph;
}

export async function leerEvento(cred: GraphCredenciales, buzon: string, id: string): Promise<EventoGraph> {
  const res = await llamar(
    cred,
    `${rutaBuzon(buzon)}/events/${encodeURIComponent(id)}?$select=${CAMPOS}`
  );
  if (!res.ok) throw await errorDe(res, 'No se pudo leer la reserva');
  return (await res.json()) as EventoGraph;
}

export async function borrarEvento(cred: GraphCredenciales, buzon: string, id: string): Promise<void> {
  const res = await llamar(cred, `${rutaBuzon(buzon)}/events/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) throw await errorDe(res, 'No se pudo cancelar la reserva');
}

/** ¿El evento es privado o confidencial? Se muestra como «Ocupado». */
export function esPrivado(e: EventoGraph): boolean {
  const s = (e.sensitivity ?? 'normal').toLowerCase();
  return s === 'private' || s === 'confidential';
}

/** ¿Cuenta como ocupación? (no cancelado y no marcado como libre). */
export function ocupa(e: EventoGraph): boolean {
  return !e.isCancelled && (e.showAs ?? 'busy').toLowerCase() !== 'free';
}

export function horasLocales(e: EventoGraph) {
  const ini = partesGraph(e.start.dateTime);
  const fin = partesGraph(e.end.dateTime);
  return { fecha: ini.fecha, horaInicio: ini.hora, fechaFin: fin.fecha, horaFin: fin.hora };
}
