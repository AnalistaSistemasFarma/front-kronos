/** Tipos compartidos del módulo Correo (servidor y navegador). */

export interface Direccion {
  nombre: string;
  correo: string;
}

export interface Carpeta {
  id: string;
  nombre: string;
  total: number;
  noLeidos: number;
}

export interface MensajeResumen {
  id: string;
  conversationId: string;
  internetMessageId: string;
  asunto: string;
  de: Direccion;
  fecha: string;
  leido: boolean;
  conAdjuntos: boolean;
  extracto: string;
  categorias: string[];
}

export interface AdjuntoInfo {
  id: string;
  nombre: string;
  tipo: string;
  tamano: number;
  enLinea: boolean;
}

export interface MensajeCompleto extends MensajeResumen {
  para: Direccion[];
  cc: Direccion[];
  /** HTML del cuerpo. En el servidor llega crudo de Graph; al navegador solo sale SANEADO. */
  html: string;
  adjuntos: AdjuntoInfo[];
  /** Enlace del mensaje en Outlook en la web (solo de Graph; el navegador lo recibe validado). */
  webLink?: string;
  /** Imágenes incrustadas (cid) como data: URI, solo dentro del servidor para el saneado. */
  imagenesCid?: Record<string, string>;
  /** Tiene imágenes cid que aún no se descargaron (se piden al desplegar el mensaje). */
  imagenesPendientes?: boolean;
}

export interface FiltrosBandeja {
  carpetaId?: string | null;
  desde?: string | null;
  hasta?: string | null;
  de?: string | null;
  noLeidos?: boolean;
  conAdjuntos?: boolean;
  buscar?: string | null;
}

export interface PaginaMensajes {
  mensajes: MensajeResumen[];
  /** Cursor opaco para la página siguiente, o null. */
  siguiente: string | null;
}

export interface ArchivoAdjunto {
  nombre: string;
  tipo: string;
  bytes: Buffer;
}

export interface RespuestaEntrada {
  /** Texto plano (nota del caso y vista en clientes sin HTML). */
  texto: string;
  todos: boolean;
  adjuntos: ArchivoAdjunto[];
  /**
   * Bloque HTML propio (acuse con plantilla). Si viene, se responde con borrador + PATCH del cuerpo
   * para dejarlo encima del historial citado; si no, el texto va como `comment`.
   */
  html?: string;
  /**
   * Cuerpo HTML YA SANEADO de la respuesta escrita por la persona (su Markdown convertido). Va como
   * `comment` de reply/createReply en lugar del texto plano; no cambia el flujo de envío.
   */
  comentarioHtml?: string;
}

/** Correo NUEVO (Redactar). El cuerpo llega YA SANEADO (Markdown de la persona convertido en el servidor). */
export interface NuevoCorreoEntrada {
  asunto: string;
  html: string;
  para: string[];
  cc: string[];
  cco: string[];
  adjuntos: ArchivoAdjunto[];
}

/** Sugerencia del autocompletado de destinatarios. */
export interface SugerenciaDestinatario extends Direccion {
  origen: 'reciente' | 'directorio';
}

/**
 * Proveedor de buzón: SIEMPRE el buzón del usuario de la sesión (mailboxForSession). No existe un
 * método que reciba otro buzón o usuario: el aislamiento es por construcción.
 */
export interface MailProvider {
  perfil(): Promise<{ correo: string }>;
  carpetas(): Promise<Carpeta[]>;
  mensajes(filtros: FiltrosBandeja, cursor?: string | null): Promise<PaginaMensajes>;
  /** Hilo en una consulta. `imagenes: 'desplegados'` baja además las imágenes cid del último y los no leídos. */
  hilo(conversationId: string, opciones?: { imagenes?: 'desplegados' | 'ninguna' }): Promise<MensajeCompleto[]>;
  /** Imágenes incrustadas (cid) de un mensaje como data: URI. Opcional (el simulado no las tiene). */
  imagenesCid?(mensajeId: string): Promise<Record<string, string>>;
  mensaje(id: string): Promise<MensajeCompleto>;
  adjunto(mensajeId: string, adjuntoId: string): Promise<ArchivoAdjunto>;
  responder(mensajeId: string, entrada: RespuestaEntrada): Promise<void>;
  categorizar(mensajeId: string, categoria: string): Promise<void>;
  /**
   * Marca mensajes del buzón propio como leídos / no leídos (como Gmail). En Graph va por `$batch`
   * de a 20, con cada sub-petición validada contra el buzón de la sesión.
   */
  marcarLeido(mensajesIds: string[], leido: boolean): Promise<{ cambiados: number; fallidos: number }>;
  /** Ids de una carpeta (null = Bandeja de entrada) con el estado CONTRARIO a `leido`, hasta `max` («Marcar todo»). */
  idsPorLeido(carpetaId: string | null, leido: boolean, max: number): Promise<string[]>;
  /** Total y no leídos de una carpeta (progreso de «Marcar todo»). */
  contadoresCarpeta(carpetaId: string | null): Promise<{ total: number; noLeidos: number }>;
  /**
   * No leídos de la Bandeja de entrada (icono del Correo en la cabecera). Opcional:
   * si el proveedor no lo trae, se calcula con carpetas().
   */
  noLeidosBandeja?(): Promise<number>;
  /**
   * Eliminar (2026-10-18). Dónde está cada mensaje DEL BUZÓN PROPIO (carpeta, hilo, Message-ID); null si no
   * existe ahí (otro buzón, ya movido o borrado). Es la validación de pertenencia antes de moverlo.
   */
  ubicarMensajes(mensajesIds: string[]): Promise<Map<string, UbicacionMensaje | null>>;
  /** Id real de la carpeta «Elementos eliminados» del buzón (para saber qué ya está ahí). */
  idCarpetaEliminados(): Promise<string>;
  /**
   * MUEVE mensajes del buzón propio a otra carpeta del MISMO buzón (Graph `move`; `deleteditems` = Elementos
   * eliminados). Graph le da un id nuevo al mensaje movido: devuelve id anterior → id nuevo (null si falló).
   * No existe una operación de borrado permanente en el módulo.
   */
  moverMensajes(mensajesIds: string[], destinoId: string): Promise<Map<string, string | null>>;
  /**
   * Redactar (2026-10-19): envía un correo NUEVO desde el buzón propio (Graph `sendMail`, o borrador + adjuntos +
   * `send` cuando hay adjuntos). Queda en «Elementos enviados» como cualquier correo de Outlook.
   */
  enviarNuevo(entrada: NuevoCorreoEntrada): Promise<void>;
  /** Personas a las que la persona les escribió hace poco (de sus «Elementos enviados»; sin el contenido). */
  contactosRecientes(max: number): Promise<Direccion[]>;
  /**
   * Directorio de la organización: personas (miembros, cuentas activas) de los dominios del inquilino cuyo nombre
   * o correo empieza por `q`. Solo nombre y correo. Opcional: sin él, el autocompletado usa solo los recientes.
   */
  buscarDirectorio?(q: string, dominios: string[], max: number): Promise<Direccion[]>;
}

export interface UbicacionMensaje {
  carpetaId: string;
  conversationId: string;
  internetMessageId: string;
  leido: boolean;
}

/** Fila de la simulación (una por hilo). */
export interface FilaSimulacion {
  conversationId: string;
  /** Mensaje de origen: el más antiguo de los seleccionados en el hilo. */
  mensajeId: string;
  internetMessageId: string;
  mensajesIds: string[];
  idCompany: number | null;
  idProcess: number | null;
  procesoSugeridoPor: 'palabra-clave' | 'predeterminado' | null;
  remitente: Direccion;
  idSolicitante: string | null;
  solicitanteNombre: string | null;
  titulo: string;
  descripcion: string;
  adjuntos: AdjuntoInfo[];
  /** Solicitud a la que ya está vinculado el hilo o el correo (duplicado). */
  duplicadoDe: number | null;
  alertas: AlertaFila[];
  incluir: boolean;
}

export type AlertaFila =
  | 'DUPLICADO'
  | 'SIN_USUARIO'
  | 'EXTERNO'
  | 'AUTOSOLICITUD'
  | 'SIN_PROCESO'
  | 'SOLICITANTE_OTRA_EMPRESA';

export const ALERTA_TEXTO: Record<AlertaFila, string> = {
  DUPLICADO: 'Ya está vinculado a una solicitud',
  SIN_USUARIO: 'El remitente no tiene usuario en SynerLink: elija el solicitante',
  EXTERNO: 'Remitente externo (fuera de los dominios del grupo)',
  AUTOSOLICITUD: 'Usted quedaría como solicitante: quien crea no puede cerrar',
  SIN_PROCESO: 'Elija el proceso',
  SOLICITANTE_OTRA_EMPRESA: 'El solicitante no pertenece a la empresa elegida',
};

/** Resultado de crear una solicitud desde una fila. */
export interface ResultadoCreacion {
  conversationId: string;
  ok: boolean;
  idRequest?: number;
  duplicado?: boolean;
  error?: string;
  adjuntosSubidos?: number;
  adjuntosFallidos?: string[];
  etiquetado?: boolean;
  /** Acuse automático en el hilo (si se pidió). */
  acuse?: ResultadoAcuse;
}

/**
 * Resultado del acuse automático en el hilo. La solicitud existe en todos los casos:
 * un ERROR u OMITIDO solo afecta la respuesta, que se puede reintentar.
 */
export interface ResultadoAcuse {
  estado: 'ENVIADO' | 'YA_ENVIADO' | 'OMITIDO' | 'DESHABILITADO' | 'ERROR';
  /** EXTERNO_SIN_CONFIRMAR: hay destinatarios fuera del grupo y no se confirmó. */
  codigo?: 'EXTERNO_SIN_CONFIRMAR' | 'NO_SOLICITADO' | 'SIN_VINCULO';
  mensaje?: string;
  /** Destinatarios (solo en ENVIADO o EXTERNO_SIN_CONFIRMAR). */
  para?: string[];
  idRequest?: number;
}

export interface VinculoHilo {
  id: number;
  conversationId: string;
  idRequest: number;
  asunto: string | null;
  creadoEn: string;
  origen: 'CREADA' | 'VINCULADA';
  /** Fecha en que se informó en el hilo (acuse); null si aún no. Solo en la vista del hilo. */
  acuseEnviadoEn?: string | null;
}
