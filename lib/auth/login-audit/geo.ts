/**
 * Geolocalización de la IP del inicio de sesión — LOCAL, en el servidor.
 *
 * NUNCA se envía la IP a un servicio externo: se consulta un archivo .mmdb
 * (formato MaxMind) que vive en el disco del servidor. Por defecto se espera la
 * base gratuita «IP to City Lite» de DB-IP (CC BY 4.0, sin registro), que se
 * descarga con scripts/geoip/descargar-dbip.mjs. Sirve igual una GeoLite2-City
 * o una base solo de países (en ese caso la ciudad queda vacía).
 *
 * Ruta: variable LOGIN_GEOIP_DB_PATH; si no está, <cwd>/data/geoip/dbip-city-lite.mmdb.
 *
 * SI FALTA EL ARCHIVO, NO PASA NADA: el inicio de sesión se registra sin país
 * (se avisa una sola vez en el log). Las IP internas se marcan «Red interna»
 * sin consultar la base.
 *
 * Memoria: el lector carga el archivo completo en RAM (≈130 MB la base de
 * ciudades, ≈8 MB la de países) la primera vez que alguien inicia sesión.
 * Revisa cada hora si el archivo cambió (actualización mensual) y lo recarga.
 */
import 'server-only';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { Reader, type CityResponse } from 'mmdb-lib';
import { LOGIN_AUDIT_LIMITS, type IpScope } from './constants';
import { classifyIp, normalizeIp } from './ip';

export interface GeoResult {
  scope: IpScope;
  countryCode: string | null;
  countryName: string | null;
  region: string | null;
  city: string | null;
}

const RECHECK_MS = 60 * 60 * 1000;

type GeoState = {
  reader: Reader<CityResponse> | null;
  mtimeMs: number;
  checkedAt: number;
  warned: boolean;
};

// En globalThis para que la recarga en caliente de desarrollo no duplique la base en memoria.
const holder = globalThis as { __kronosLoginGeo?: GeoState };
const state: GeoState =
  holder.__kronosLoginGeo ??
  (holder.__kronosLoginGeo = { reader: null, mtimeMs: 0, checkedAt: 0, warned: false });

export function geoDbPath(): string {
  const configured = process.env.LOGIN_GEOIP_DB_PATH?.trim();
  return configured || path.join(process.cwd(), 'data', 'geoip', 'dbip-city-lite.mmdb');
}

function getReader(): Reader<CityResponse> | null {
  const now = Date.now();
  if (state.reader && now - state.checkedAt < RECHECK_MS) return state.reader;
  if (!state.reader && state.warned && now - state.checkedAt < RECHECK_MS) return null;
  state.checkedAt = now;

  const file = geoDbPath();
  try {
    // La ruta sale de la configuración del servidor (LOGIN_GEOIP_DB_PATH), nunca de la petición.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const { mtimeMs } = statSync(file);
    if (!state.reader || mtimeMs !== state.mtimeMs) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- misma ruta de configuración
      state.reader = new Reader<CityResponse>(readFileSync(file));
      state.mtimeMs = mtimeMs;
      state.warned = false;
    }
  } catch (error) {
    if (!state.warned) {
      console.warn(
        `[login-audit] Sin base de geolocalización en ${file}: los inicios de sesión se registran sin país.`,
        error instanceof Error ? error.message : error
      );
      state.warned = true;
    }
    // Si había una base cargada y el archivo desapareció, se sigue usando la cargada.
  }
  return state.reader;
}

function pickName(names: Record<string, string> | undefined, max: number): string | null {
  if (!names) return null;
  const value = names.es ?? names.en ?? Object.values(names)[0];
  return value ? String(value).slice(0, max) : null;
}

const EMPTY = { countryCode: null, countryName: null, region: null, city: null };

/** País, región y ciudad de la IP. Nunca lanza. */
export function geolocateIp(rawIp: string | null | undefined): GeoResult {
  const ip = normalizeIp(rawIp);
  const scope = classifyIp(ip);
  if (scope !== 'PUBLICA' || !ip) return { scope, ...EMPTY };

  try {
    const reader = getReader();
    const hit = reader?.get(ip);
    if (!hit) return { scope, ...EMPTY };
    const country = hit.country ?? hit.registered_country;
    const code = country?.iso_code ? String(country.iso_code).toUpperCase().slice(0, 2) : null;
    return {
      scope,
      countryCode: code,
      countryName: pickName(country?.names as Record<string, string> | undefined, LOGIN_AUDIT_LIMITS.countryName),
      region: pickName(
        hit.subdivisions?.[0]?.names as Record<string, string> | undefined,
        LOGIN_AUDIT_LIMITS.region
      ),
      city: pickName(hit.city?.names as Record<string, string> | undefined, LOGIN_AUDIT_LIMITS.city),
    };
  } catch (error) {
    console.error('[login-audit] Error al geolocalizar:', error instanceof Error ? error.message : error);
    return { scope, ...EMPTY };
  }
}
