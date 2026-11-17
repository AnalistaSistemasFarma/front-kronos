/**
 * Configuración del módulo de Salas. SOLO servidor: lee variables de entorno.
 *
 *   SALAS_ROOMS          buzón|Nombre[|díasVentana];buzón2|Nombre2…  (obligatoria)
 *   SALAS_GRAPH_*        credenciales de la app de Graph (nunca salen al cliente)
 *   SALAS_SOLO_LECTURA   "1" bloquea crear y cancelar en Graph
 *   SALAS_VENTANA_DIAS   opcional, buzón|días;… (BookingWindowInDays de cada sala)
 *
 * Las salas nunca se escriben a mano en el código: salen de SALAS_ROOMS. Al
 * navegador solo viaja un identificador de sala (la parte local del buzón), no
 * el buzón completo.
 */

/** Ventana de reserva por defecto (salas administrativas y de invitados). */
export const VENTANA_DEFECTO_DIAS = 15;
/**
 * Ventanas conocidas al 2026-11-17 (BookingWindowInDays de Exchange). Se usan
 * solo si ni SALAS_ROOMS ni SALAS_VENTANA_DIAS traen el valor de la sala.
 */
const VENTANAS_CONOCIDAS: Record<string, number> = { quietroom: 10 };

export interface Sala {
  /** Identificador público (parte local del buzón, en minúsculas). */
  id: string;
  /** Buzón de la sala. SOLO servidor. */
  buzon: string;
  nombre: string;
  /** Días hacia adelante que la sala acepta reservas. */
  ventanaDias: number;
}

/** Vista segura para el navegador. */
export interface SalaPublica {
  id: string;
  nombre: string;
  ventanaDias: number;
}

const BUZON_RE = /^[a-z0-9._%+-]{1,64}@[a-z0-9.-]{1,253}\.[a-z]{2,}$/;

function diasValidos(valor: string | undefined): number | null {
  if (!valor) return null;
  const n = Number(valor.trim());
  return Number.isInteger(n) && n >= 1 && n <= 1080 ? n : null;
}

function mapaVentanas(raw: string | undefined): Map<string, number> {
  const mapa = new Map<string, number>();
  for (const parte of (raw ?? '').split(';')) {
    const [buzon, dias] = parte.split('|').map((s) => s.trim());
    const n = diasValidos(dias);
    if (buzon && n) mapa.set(buzon.toLowerCase(), n);
  }
  return mapa;
}

/** Interpreta SALAS_ROOMS. Ignora entradas mal formadas o repetidas. */
export function parseSalas(raw: string | undefined, ventanasRaw?: string): Sala[] {
  const ventanas = mapaVentanas(ventanasRaw);
  const salas: Sala[] = [];
  const vistos = new Set<string>();
  for (const parte of (raw ?? '').split(';')) {
    const [buzonRaw, nombreRaw, diasRaw] = parte.split('|');
    const buzon = (buzonRaw ?? '').trim().toLowerCase();
    if (!BUZON_RE.test(buzon)) continue;
    const id = buzon.split('@')[0];
    if (vistos.has(id)) continue;
    vistos.add(id);
    const nombre = (nombreRaw ?? '').trim() || id;
    const ventanaDias =
      diasValidos(diasRaw) ??
      ventanas.get(buzon) ??
      VENTANAS_CONOCIDAS[id] ??
      VENTANA_DEFECTO_DIAS;
    salas.push({ id, buzon, nombre, ventanaDias });
  }
  return salas;
}

export function salasPublicas(salas: Sala[]): SalaPublica[] {
  return salas.map(({ id, nombre, ventanaDias }) => ({ id, nombre, ventanaDias }));
}

/** ¿El ambiente está en modo de solo lectura? */
export function esSoloLectura(valor: string | undefined = process.env.SALAS_SOLO_LECTURA): boolean {
  const v = (valor ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'si' || v === 'sí';
}

export const MENSAJE_SOLO_LECTURA =
  'Modo de solo lectura: en este ambiente no se crean ni cancelan reservas en las salas reales.';

export interface GraphCredenciales {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

/** Credenciales de Graph, o null si faltan. SOLO servidor; nunca se registran ni se devuelven. */
export function credencialesGraph(env: NodeJS.ProcessEnv = process.env): GraphCredenciales | null {
  const tenantId = env.SALAS_GRAPH_TENANT_ID?.trim();
  const clientId = env.SALAS_GRAPH_CLIENT_ID?.trim();
  const clientSecret = env.SALAS_GRAPH_CLIENT_SECRET?.trim();
  if (!tenantId || !clientId || !clientSecret) return null;
  return { tenantId, clientId, clientSecret };
}

/** Salas configuradas en el ambiente. */
export function salasDelAmbiente(env: NodeJS.ProcessEnv = process.env): Sala[] {
  return parseSalas(env.SALAS_ROOMS, env.SALAS_VENTANA_DIAS);
}
