/**
 * Memoria compartida de GET /api/administration/api-clients entre la lista (ApiPermissionsPanel)
 * y la pantalla del cliente (ApiClientPage), 2026-11-11. Al pasar de una a otra se pinta al
 * instante con lo último conocido y se refresca por detrás (cada petición cuesta ~1 s en
 * desarrollo). Vive solo en esta pestaña del navegador y nunca guarda llaves en claro (la
 * respuesta no las trae). La autorización sigue en el servidor: si la recarga responde 403,
 * cada pantalla muestra el error y se borra la memoria.
 */
import type { ApiClientsResponse } from './types';

let cached: ApiClientsResponse | null = null;

export function readApiClientsCache(): ApiClientsResponse | null {
  return cached;
}

export function writeApiClientsCache(data: ApiClientsResponse | null): void {
  cached = data;
}
