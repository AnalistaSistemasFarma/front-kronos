import { FormacionStorageNoConfigurado } from '@/lib/portal/formacion-storage';
import { PoliticasError } from '@/lib/portal/politicas-storage';

/**
 * Traduce un fallo de Graph/configuración al mensaje que ve la persona. Nunca
 * incluye detalles internos (ids, rutas de Graph, secretos): eso va al log.
 */
export function mensajeErrorPoliticas(error: unknown, accion: 'listar' | 'vista'): { status: number; mensaje: string } {
  if (error instanceof FormacionStorageNoConfigurado) {
    return {
      status: 503,
      mensaje:
        'La conexión del portal con SharePoint (Talento Humano) no está configurada. Avise a Tecnología.',
    };
  }
  if (error instanceof PoliticasError && (error.status === 401 || error.status === 403)) {
    return {
      status: 502,
      mensaje: 'El portal no tiene permiso para leer la carpeta de políticas en SharePoint. Avise a Tecnología.',
    };
  }
  if (error instanceof PoliticasError && error.status === 404 && accion === 'listar') {
    return { status: 502, mensaje: 'No se encontró la carpeta de políticas en SharePoint. Avise a Tecnología.' };
  }
  return {
    status: 502,
    mensaje:
      accion === 'listar'
        ? 'No se pudo leer la carpeta de políticas. Intente en un momento.'
        : 'No se pudo preparar la vista previa del documento. Intente en un momento.',
  };
}
