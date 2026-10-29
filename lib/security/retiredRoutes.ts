/**
 * Rutas retiradas por seguridad.
 *
 * `/api/purchase-request/*` (la versión vieja de solicitudes de compra) devolvía al
 * navegador la contraseña del Service Layer guardada en `sap_endpoints` y tenía dos
 * endpoints sin sesión (`auth` y `drafts`) que se conectaban a la dirección que les
 * llegara en el cuerpo (SSRF). No tenía usuarios asignados y se eliminó el
 * 2026-10-29. El módulo de Compras vigente vive en `/api/purchases/*` y no se toca.
 *
 * Además de borrar los archivos, el middleware responde 410 a estas rutas: así
 * quedan cerradas aunque en un servidor sobreviva un `route.ts` viejo sin versionar
 * (pasó en la .230 con archivos bloqueados por Windows durante un despliegue).
 */
const RETIRED_API_PREFIXES = ['/api/purchase-request'];

export function isRetiredApiPath(pathname: string): boolean {
  const path = pathname.toLowerCase();
  return RETIRED_API_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}
