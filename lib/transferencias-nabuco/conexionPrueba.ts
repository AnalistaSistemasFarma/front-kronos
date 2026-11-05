import { DEFAULTS, LIMITES } from './constants';
import { NabucoDiagnosticoError, diagnosticoValidacion } from './diagnostico';
import { MENSAJE_PROTOCOLO_NABUCO, protocoloNabucoPermitido, type NabucoConexion } from './nabucoClient';
import type { NabucoConfig } from './db';

/**
 * «Probar conexión» con los datos que están en pantalla (sin guardarlos). Cada campo que venga en el
 * body reemplaza al guardado SOLO para esta prueba; contraseña vacía = la guardada (descifrada).
 * Valida igual que al guardar (protocolo y rutas). Nunca guarda nada.
 */

export type ConfigConexion = Pick<NabucoConfig, 'nabuco_url' | 'nabuco_usuario' | 'nabuco_password_enc' | 'nabuco_org' | 'ruta_token' | 'ruta_solicitudes' | 'timeout_ms'>;

export interface ConexionPrueba {
  conexion: NabucoConexion;
  /** true si lo probado difiere de lo guardado (no se toca la caché de token de la config). */
  usaCambiosSinGuardar: boolean;
  cambios: string[];
}

const RUTA_RE = /^\/[A-Za-z0-9_\-/.]{0,190}$/;

function txt(v: unknown): string | undefined {
  return typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : undefined;
}

function falla(mensaje: string, sugerencia?: string): never {
  throw new NabucoDiagnosticoError(diagnosticoValidacion(mensaje, sugerencia));
}

export function resolverConexionPrueba(
  cfg: ConfigConexion,
  body: Record<string, unknown> | null | undefined,
  descifrar: (enc: string) => string,
  env: Record<string, string | undefined> = process.env
): ConexionPrueba {
  const b = body ?? {};
  const cambios: string[] = [];
  const elegir = (campo: string, guardado: string | null): string => {
    const v = txt(b[campo]);
    if (v === undefined) return guardado ?? '';
    if (v !== (guardado ?? '')) cambios.push(campo);
    return v;
  };
  const url = elegir('nabuco_url', cfg.nabuco_url);
  const usuario = elegir('nabuco_usuario', cfg.nabuco_usuario);
  const org = elegir('nabuco_org', cfg.nabuco_org) || DEFAULTS.org;
  const rutaToken = elegir('ruta_token', cfg.ruta_token) || DEFAULTS.rutaToken;
  const pwdPantalla = typeof b.nabuco_password === 'string' ? b.nabuco_password : '';
  if (pwdPantalla) cambios.push('nabuco_password');

  let timeoutMs = cfg.timeout_ms;
  if (b.timeout_ms !== undefined && b.timeout_ms !== null && b.timeout_ms !== '') {
    const n = Number(b.timeout_ms);
    if (!Number.isInteger(n) || n < LIMITES.timeoutMs.min || n > LIMITES.timeoutMs.max) falla(`El timeout debe ser un entero entre ${LIMITES.timeoutMs.min} y ${LIMITES.timeoutMs.max} ms.`);
    if (n !== cfg.timeout_ms) cambios.push('timeout_ms');
    timeoutMs = n;
  }

  const faltan = [!url && 'la URL', !usuario && 'el usuario', !pwdPantalla && !cfg.nabuco_password_enc && 'la contraseña'].filter(Boolean) as string[];
  if (faltan.length) {
    falla(`Falta ${faltan.join(', ')} de Nabuco: no está escrito en pantalla ni guardado en la configuración.`, 'Escríbalo en el formulario (puede probar sin guardar) o guarde la configuración.');
  }
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    falla(`La URL de Nabuco «${url}» no es válida.`, 'Escriba la URL completa con protocolo, p. ej. https://servidor:puerto');
  }
  if (!protocoloNabucoPermitido(u, env)) falla(MENSAJE_PROTOCOLO_NABUCO);
  if (!RUTA_RE.test(rutaToken)) falla('La ruta de token debe empezar por «/» y no llevar espacios.');

  return {
    conexion: {
      url,
      usuario,
      password: pwdPantalla || descifrar(cfg.nabuco_password_enc as string),
      org,
      rutaToken,
      rutaSolicitudes: cfg.ruta_solicitudes,
      timeoutMs,
    },
    usaCambiosSinGuardar: cambios.length > 0,
    cambios,
  };
}
