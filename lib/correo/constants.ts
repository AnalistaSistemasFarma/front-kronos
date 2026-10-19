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

/**
 * Redactar (2026-10-19, pedido de Nicolás Rivera): correo NUEVO desde el buzón de la sesión. Mismos topes de
 * adjuntos y de texto que la respuesta (3 MB por archivo, 5 archivos, 10 MB en total). Destinatarios: máximo
 * entre Para, CC y CCO juntos (Exchange admite 500; aquí se limita para que un error no llegue a media empresa).
 */
export const CORREO_MAX_DESTINATARIOS = 50;
/** Asunto del correo nuevo (Outlook admite 255). */
export const CORREO_MAX_ASUNTO_NUEVO = 255;
/** Autocompletado de destinatarios: sugerencias por consulta y largo de la búsqueda. */
export const CORREO_MAX_SUGERENCIAS = 8;
export const CORREO_MAX_BUSQUEDA_DESTINATARIO = 60;
/** Contactos recientes: se leen de los últimos correos ENVIADOS del buzón propio, en caché corta en memoria. */
export const CORREO_RECIENTES_MENSAJES = 50;
export const CORREO_RECIENTES_CACHE_MS = 5 * 60_000;

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
  'VINCULO_HUERFANO',
  'MARCAR_LEIDO',
  'MARCAR_NO_LEIDO',
  // «Consultar a un agente» (2026-10-16): concesión, lecturas y propuestas del agente, decisiones de la persona.
  'COMPARTIR_AGENTE',
  'REVOCAR_AGENTE',
  'AGENTE_LEER_HILO',
  'AGENTE_LEER_ADJUNTO',
  'AGENTE_PROPONER',
  'AGENTE_DENEGADO',
  'AGENTE_CONFIRMAR',
  'AGENTE_DESCARTAR',
  'AGENTE_FALLIDO',
  // Deslizar para eliminar (2026-10-18): mover a «Elementos eliminados» y «Deshacer» (nunca se borra de forma permanente).
  'ELIMINAR',
  'RESTAURAR',
  // Redactar (2026-10-19): correo nuevo desde el buzón propio. Se registran destinatarios y asunto, nunca el cuerpo.
  'ENVIAR_NUEVO',
] as const;
export type CorreoAuditAccion = (typeof CORREO_AUDIT_ACCIONES)[number];

/** Tipo de mensaje registrado en un hilo vinculado (dbo.email_thread_message.tipo). */
export type CorreoTipoMensaje = 'ORIGEN' | 'NOTA' | 'RESPUESTA';

/** Microsoft Graph v1.0. Las rutas de buzón SOLO las arma mailboxForSession (lib/correo/graph.ts). */
export const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
/** Graph `$batch`: máximo 20 sub-peticiones por lote. */
export const GRAPH_BATCH_MAX = 20;
/** «Marcar como leído» de correos seleccionados: tope por petición. */
export const CORREO_MAX_MARCAR_SELECCION = 100;
/** «Marcar todo» de una carpeta: correos por petición (el navegador repite hasta terminar y muestra el avance). */
export const CORREO_LOTE_MARCAR_CARPETA = 200;
/** «Marcar todo»: tope total por acción; por encima se pide confirmación desde CORREO_CONFIRMAR_MARCAR_CARPETA. */
export const CORREO_MAX_MARCAR_CARPETA = 5_000;
export const CORREO_CONFIRMAR_MARCAR_CARPETA = 500;

/**
 * Eliminar (deslizar a la izquierda, botón o selección; 2026-10-18): correos por petición. Se MUEVEN a
 * «Elementos eliminados» (Graph `move` a `deleteditems`); nunca se borran de forma permanente.
 */
export const CORREO_MAX_ELIMINAR_SELECCION = 100;
/** Vigencia del comprobante firmado de «Deshacer» (el aviso dura ~7 s; el margen cubre una red lenta). */
export const CORREO_DESHACER_VIGENCIA_MS = 5 * 60_000;

/**
 * «Consultar a un agente» (diseño aprobado por Nicolás Rivera, 2026-10-16 09:24–09:27): la persona
 * comparte UN hilo con UNO de sus agentes del chat. Vigencia de la concesión y topes del mensaje de
 * contexto (el chat admite 8.000 caracteres por mensaje de persona).
 */
export const CORREO_AGENTE_VIGENCIA_MS = 24 * 60 * 60_000;
export const CORREO_AGENTE_MAX_CONTEXTO = 7_600;
export const CORREO_AGENTE_MAX_EXTRACTO = 1_500;
export const CORREO_AGENTE_MAX_PREGUNTA = 1_000;
/** Nota del caso propuesta por el agente. */
export const CORREO_AGENTE_MAX_NOTA = 4_000;
