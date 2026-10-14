/**
 * S14 (R23, reunión con Calidad OLP del 2026-10-13, 12:19): «No lo deja, ¿se
 * ve que no tiene permiso?». La auditoría de producción muestra que el
 * servidor SÍ le entregó la copia a Calidad (documento.consulta a las 12:19:32
 * COT); lo que se vio fue el visor sin documento. Desde el S14 el visor dice
 * claramente qué pasa: sin permiso (con la opción de solicitar acceso), un
 * error técnico (con reintentar) o la protección del visor (ventana inactiva,
 * que NO es un problema de permisos). Función pura.
 */
export type SgcViewerErrorKind = 'sin_permiso' | 'tecnico';

export interface SgcViewerError {
  kind: SgcViewerErrorKind;
  title: string;
  message: string;
}

export function sgcViewerError(status: number | null, apiMessage: string | null | undefined): SgcViewerError {
  if (status === 401) {
    return { kind: 'tecnico', title: 'Su sesión terminó', message: 'Vuelva a iniciar sesión en SynerLink y abra el documento de nuevo.' };
  }
  if (status === 403 || status === 404) {
    return {
      kind: 'sin_permiso',
      title: 'No tiene permiso para consultar este documento',
      message: 'El documento no está en su alcance de consulta (o ya no está vigente). Puede solicitar el acceso a Aseguramiento de Calidad con su justificación.',
    };
  }
  return { kind: 'tecnico', title: 'No se pudo abrir el documento', message: (apiMessage ?? '').trim() || 'Ocurrió un error al preparar la copia controlada. Intente de nuevo.' };
}

/** Texto del aviso de la protección del visor (ventana inactiva): no es un problema de permisos. */
export const SGC_VIEWER_VEIL_TEXT =
  'Protección del visor: el documento se oculta mientras esta ventana no está activa (por ejemplo, al compartir pantalla en Teams o al cambiar de programa). No es un problema de permisos: vuelva a esta ventana o use «Mostrar el documento».';
