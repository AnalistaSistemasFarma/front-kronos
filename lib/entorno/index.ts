/**
 * Identificación visual del ENTORNO DE PRUEBAS (pedido de Nicolás, 2026-10-22:
 * «no sé distinguir cuál de las 2 es testing»).
 *
 * Se activa SOLO con `SYNERLINK_ENTORNO=pruebas` en el `.env` del servidor de
 * pruebas (.230). Es una variable de servidor, NO `NEXT_PUBLIC_*`: se lee en el
 * layout raíz (que es dinámico) y en el manifest al compilar en la .230. En
 * producción la variable no existe y todo queda exactamente como antes: mismo
 * título, mismo favicon (`app/favicon.ico`), mismo manifest y sin franja.
 */

export const VARIABLE_ENTORNO = 'SYNERLINK_ENTORNO';
export const PREFIJO_TITULO_PRUEBAS = '🧪 TEST · ';

export function esEntornoPruebas(env: Record<string, string | undefined> = process.env): boolean {
  return (env[VARIABLE_ENTORNO] ?? '').trim().toLowerCase() === 'pruebas';
}

export function tituloSegunEntorno(titulo: string, pruebas: boolean): string {
  return pruebas ? `${PREFIJO_TITULO_PRUEBAS}${titulo}` : titulo;
}

/** Íconos de la variante ámbar con franja «TEST» (scripts/generar-iconos-pruebas.mjs). */
export const ICONOS_PRUEBAS = {
  svg: '/icons/pruebas/favicon-pruebas.svg',
  png: '/icons/pruebas/favicon-pruebas.png',
  apple: '/icons/pruebas/apple-touch-icon-pruebas.png',
  png192: '/icons/pruebas/icon-pruebas-192.png',
  png512: '/icons/pruebas/icon-pruebas-512.png',
} as const;
