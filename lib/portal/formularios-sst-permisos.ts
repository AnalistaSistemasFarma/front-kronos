/**
 * PORTAL TH — FORMULARIOS SST — quién ve las respuestas (Cristian Baldión, 2026-10-19).
 *
 * Los formularios «Reporte de actos y condiciones inseguras SST» y «Condiciones de salud y sintomatología osteomuscular» guardan sus
 * respuestas en SharePoint (`FORMULARIOS SST`). Incluyen datos sensibles (cédula, teléfono, salud; Ley 1581 de 2012), así que las
 * respuestas NO las ve cualquiera que entre al portal: solo estas dos listas.
 *
 *   ADMINISTRADORES  ven todas las respuestas y las exportan (Cristian).
 *   LECTORES         ven y exportan las respuestas (grupo de SST que indicó Cristian el 2026-10-19).
 *
 * Por defecto son las listas de abajo; cambian con las variables `PORTAL_TH_SST_ADMINISTRADORES` y `PORTAL_TH_SST_LECTORES`
 * (correos separados por coma), sin tocar el código. Quien administra también lee.
 *
 * `sst@gsslatam.com` (buzón compartido) NO está en la lista a propósito: entra al portal con un código que llega a ese buzón, y quien
 * lo abra vería datos de salud sin que quede constancia de quién fue. Si se quiere agregar, se agrega a mano y a sabiendas.
 */

export const ADMINISTRADORES_SST_POR_DEFECTO = ['cristian.baldion@gsslatam.com'] as const;

export const LECTORES_SST_POR_DEFECTO = [
  'ximena.santamaria@gsslatam.com',
  'sandy.cardenal@gsslatam.com',
  'nairoby.banquett@gsslatam.com',
  'sofia.toquica@gsslatam.com',
  'evelyn.pantoja@gsslatam.com',
] as const;

/** Un correo razonable: sin espacios, una sola arroba y un dominio con punto. */
const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function lista(crudo: string | undefined, porDefecto: readonly string[]): string[] {
  const texto = (crudo ?? '').trim();
  const correos = texto ? texto.split(',').map((c) => c.trim().toLowerCase()) : [...porDefecto];
  return [...new Set(correos.filter((c) => CORREO.test(c)))];
}

export function administradoresSst(env: NodeJS.ProcessEnv = process.env): string[] {
  return lista(env.PORTAL_TH_SST_ADMINISTRADORES, ADMINISTRADORES_SST_POR_DEFECTO);
}

/** Quienes pueden VER las respuestas: los lectores y también los administradores. */
export function lectoresSst(env: NodeJS.ProcessEnv = process.env): string[] {
  return [...new Set([...lista(env.PORTAL_TH_SST_LECTORES, LECTORES_SST_POR_DEFECTO), ...administradoresSst(env)])];
}

const normalizar = (correo: unknown) => (typeof correo === 'string' ? correo.trim().toLowerCase() : '');

export function esAdministradorSst(correo: unknown, env: NodeJS.ProcessEnv = process.env): boolean {
  const c = normalizar(correo);
  return c !== '' && administradoresSst(env).includes(c);
}

/** ¿Puede ver (y exportar) las respuestas de los formularios SST? */
export function puedeVerRespuestasSst(correo: unknown, env: NodeJS.ProcessEnv = process.env): boolean {
  const c = normalizar(correo);
  return c !== '' && lectoresSst(env).includes(c);
}
