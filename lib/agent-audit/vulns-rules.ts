/**
 * AUDITORÍA DE AGENTES → VULNERABILIDADES (OSV) — piezas PURAS.
 *
 * Pedido de Nicolás Rivera (2026-11-19): «consumiendo la API de OSV queremos averiguar las
 * vulnerabilidades recientes todo el tiempo para poder protegernos rápidamente».
 *
 * Cómo funciona: el escáner de la Mac de horus (scripts/agent-vulns/escaner.py) lee las dependencias
 * reales de cada repositorio (lockfiles de npm, go.mod, requirements de Python) en sus ramas de
 * producción y pruebas, las consulta en OSV (api.osv.dev, solo nombre de paquete + versión, que son
 * públicos) y publica aquí. Corre cada 6 horas y cuando alguien pulsa «Escanear ahora».
 * Sin BD ni `server-only`: lo usan la API, la pantalla y las pruebas.
 */

export const SEVERIDADES_VULN = {
  critica: 'Crítica',
  alta: 'Alta',
  media: 'Media',
  baja: 'Baja',
  desconocida: 'Sin clasificar',
} as const;
export type SeveridadVuln = keyof typeof SEVERIDADES_VULN;
export const ORDEN_SEVERIDAD_VULN: SeveridadVuln[] = ['critica', 'alta', 'media', 'baja', 'desconocida'];

export const ESTADOS_VULN = {
  nuevo: 'Nuevo',
  en_revision: 'En revisión',
  corregido: 'Corregido',
  aceptado: 'Riesgo aceptado',
  falso_positivo: 'No aplica',
} as const;
export type EstadoVuln = keyof typeof ESTADOS_VULN;

export const ECOSISTEMAS = ['npm', 'Go', 'PyPI'] as const;
export type Ecosistema = (typeof ECOSISTEMAS)[number];

const tiene = (o: object, k: unknown): boolean => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);
export const esSeveridadVuln = (v: unknown): v is SeveridadVuln => tiene(SEVERIDADES_VULN, v);
export const esEstadoVuln = (v: unknown): v is EstadoVuln => tiene(ESTADOS_VULN, v);

/** Severidad de OSV/GHSA («CRITICAL», «HIGH», «MODERATE», «LOW») → la nuestra. */
export function severidadDesdeOsv(v: unknown): SeveridadVuln {
  const s = String(v ?? '').trim().toUpperCase();
  if (s === 'CRITICAL') return 'critica';
  if (s === 'HIGH') return 'alta';
  if (s === 'MODERATE' || s === 'MEDIUM') return 'media';
  if (s === 'LOW') return 'baja';
  return 'desconocida';
}

/** ¿La vulnerabilidad es «reciente»? (publicada o vista por primera vez hace menos de N días). */
export function esReciente(fechaIso: string | null | undefined, dias = 7, ahora = Date.now()): boolean {
  if (!fechaIso) return false;
  const t = Date.parse(fechaIso);
  return Number.isFinite(t) && ahora - t <= dias * 86_400_000 && t <= ahora + 60_000;
}

/** Enlace público de la vulnerabilidad en osv.dev (el id viene de OSV: GHSA-…, GO-…, PYSEC-…, CVE-…). */
export function enlaceOsv(vulnId: string): string {
  return `https://osv.dev/vulnerability/${encodeURIComponent(vulnId)}`;
}

function texto(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
   
  const t = v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
const fecha = (v: unknown): string | null => (typeof v === 'string' && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null);
const entero = (v: unknown, min = 0, max = 10_000_000): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : null;

export class VulnValidacionError extends Error {}

export interface HallazgoVulnEntrada {
  repo: string;
  rama: string;
  archivo: string;
  ecosistema: Ecosistema;
  paquete: string;
  version: string;
  directa: boolean;
  vulnId: string;
  alias: string | null;
  resumen: string | null;
  severidad: SeveridadVuln;
  publicada: string | null;
  modificada: string | null;
  versionCorregida: string | null;
  referencia: string | null;
}

export interface PublicacionVulns {
  idRun: number;
  repos: number | null;
  paquetes: number | null;
  resumen: string | null;
  hallazgos: HallazgoVulnEntrada[];
}

export const MAX_HALLAZGOS_VULN = 20_000;
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const VULN_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,79}$/;

/** Valida lo que manda el escáner. Solo acepta enlaces https. */
export function parsePublicacionVulns(body: unknown): PublicacionVulns {
  const b = (body ?? {}) as Record<string, unknown>;
  const idRun = entero(b.idRun, 1);
  if (!idRun) throw new VulnValidacionError('idRun inválido');
  if (!Array.isArray(b.hallazgos)) throw new VulnValidacionError('hallazgos debe ser una lista');
  if (b.hallazgos.length > MAX_HALLAZGOS_VULN) throw new VulnValidacionError(`Máximo ${MAX_HALLAZGOS_VULN} hallazgos por escaneo`);
  const hallazgos = b.hallazgos.map((x, i): HallazgoVulnEntrada => {
    const h = (x ?? {}) as Record<string, unknown>;
    const repo = texto(h.repo, 150);
    if (!repo || !REPO.test(repo)) throw new VulnValidacionError(`Hallazgo ${i}: repositorio inválido`);
    if (!(ECOSISTEMAS as readonly string[]).includes(String(h.ecosistema))) throw new VulnValidacionError(`Hallazgo ${i}: ecosistema inválido`);
    const vulnId = texto(h.vulnId, 80);
    if (!vulnId || !VULN_ID.test(vulnId)) throw new VulnValidacionError(`Hallazgo ${i}: id de vulnerabilidad inválido`);
    const paquete = texto(h.paquete, 250);
    const version = texto(h.version, 80);
    const rama = texto(h.rama, 100);
    const archivo = texto(h.archivo, 300);
    if (!paquete || !version || !rama || !archivo) throw new VulnValidacionError(`Hallazgo ${i}: faltan paquete, versión, rama o archivo`);
    const ref = texto(h.referencia, 500);
    return {
      repo,
      rama,
      archivo,
      ecosistema: h.ecosistema as Ecosistema,
      paquete,
      version,
      directa: h.directa === true,
      vulnId,
      alias: texto(h.alias, 400),
      resumen: texto(h.resumen, 600),
      severidad: esSeveridadVuln(h.severidad) ? h.severidad : 'desconocida',
      publicada: fecha(h.publicada),
      modificada: fecha(h.modificada),
      versionCorregida: texto(h.versionCorregida, 200),
      referencia: ref && /^https:\/\//i.test(ref) ? ref : null,
    };
  });
  return { idRun, repos: entero(b.repos), paquetes: entero(b.paquetes), resumen: texto(b.resumen, 2000), hallazgos };
}
