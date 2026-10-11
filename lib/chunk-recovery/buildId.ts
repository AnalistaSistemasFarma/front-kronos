/** Compara el build cargado en el navegador con el que sirve el servidor. */
export function isNewBuild(current: string | undefined | null, server: string | undefined | null): boolean {
  if (!current || !server) return false;
  return current.trim() !== server.trim();
}
