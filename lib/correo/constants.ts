/**
 * Módulo «Correo» de SynerLink (2026-10-15, idea de Nicolás Rivera para Jurídica).
 *
 * Cada persona ve SU buzón de Outlook dentro de SynerLink, revisa hilos, responde
 * sobre un hilo y convierte correos en solicitudes con una simulación previa. Los
 * hilos convertidos quedan vinculados a su solicitud. Graph se consulta con la app
 * de APLICACIÓN del inquilino (decisión de Nicolás, 2026-10-15 10:26); el buzón
 * SIEMPRE es el del usuario de la sesión (lib/correo/graph.ts → mailboxForSession).
 */

/** Subproceso-permiso (entrada del menú). Se otorga por persona y empresa en Administración → Usuarios. */
export const CORREO_SUBPROCESS_URL = '/process/correo';
export const CORREO_SUBPROCESS_NAME = 'Correo';
/** Proceso contenedor del menú donde se siembra el subproceso. */
export const CORREO_PROCESS_NAME = 'Solicitudes';

/** Mensajes por página de la bandeja. */
export const CORREO_PAGE_SIZE = 25;
/** Máximo de hilos por simulación / creación masiva. */
export const CORREO_MAX_LOTE = 50;
/** Largo máximo de la descripción (requests_general.description es NVARCHAR(1000)). */
export const CORREO_MAX_DESCRIPCION = 1000;
/** Largo máximo del asunto (requests_general.subject_request es NVARCHAR(255)). */
export const CORREO_MAX_ASUNTO = 255;
/** Largo máximo del extracto que pasa a una nota de la solicitud. */
export const CORREO_MAX_NOTA = 2000;
/** Adjuntos: tamaño máximo por archivo que se copia a la solicitud (OneDrive). */
export const CORREO_MAX_ADJUNTO_BYTES = 25 * 1024 * 1024;
/** Respuesta: tamaño máximo por adjunto (Graph admite hasta 3 MB por llamada simple). */
export const CORREO_MAX_ADJUNTO_RESPUESTA_BYTES = 3 * 1024 * 1024;
/** Respuesta: máximo de adjuntos y tamaño total. */
export const CORREO_MAX_ADJUNTOS_RESPUESTA = 5;
export const CORREO_MAX_TOTAL_RESPUESTA_BYTES = 10 * 1024 * 1024;
/** Texto de la respuesta (sin adjuntos). */
export const CORREO_MAX_RESPUESTA_CHARS = 20_000;

/** Categoría de Outlook con la que se marca un correo convertido: «SynerLink #123». */
export const CORREO_CATEGORIA_PREFIJO = 'SynerLink #';
export function correoCategoria(idRequest: number): string {
  return `${CORREO_CATEGORIA_PREFIJO}${idRequest}`;
}

/** Acciones del registro de auditoría (dbo.email_audit). */
export const CORREO_AUDIT_ACCIONES = [
  'LEER_CARPETAS',
  'LEER_BANDEJA',
  'LEER_HILO',
  'DESCARGAR_ADJUNTO',
  'SIMULAR',
  'CREAR_SOLICITUD',
  'VINCULAR',
  'RESPONDER',
  'NOTA_HILO',
  'ETIQUETAR',
  'ACUSE_HILO',
  'ACUSE_HILO_FALLIDO',
] as const;
export type CorreoAuditAccion = (typeof CORREO_AUDIT_ACCIONES)[number];

/** Tipo de mensaje registrado en un hilo vinculado (dbo.email_thread_message.tipo). */
export type CorreoTipoMensaje = 'ORIGEN' | 'NOTA' | 'RESPUESTA';

/** Microsoft Graph v1.0. Las rutas de buzón SOLO las arma mailboxForSession (lib/correo/graph.ts). */
export const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
