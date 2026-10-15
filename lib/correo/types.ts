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
  /** Imágenes incrustadas (cid) como data: URI, solo dentro del servidor para el saneado. */
  imagenesCid?: Record<string, string>;
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
}

/**
 * Proveedor de buzón: SIEMPRE el buzón del usuario de la sesión (mailboxForSession). No existe un
 * método que reciba otro buzón o usuario: el aislamiento es por construcción.
 */
export interface MailProvider {
  perfil(): Promise<{ correo: string }>;
  carpetas(): Promise<Carpeta[]>;
  mensajes(filtros: FiltrosBandeja, cursor?: string | null): Promise<PaginaMensajes>;
  hilo(conversationId: string): Promise<MensajeCompleto[]>;
  mensaje(id: string): Promise<MensajeCompleto>;
  adjunto(mensajeId: string, adjuntoId: string): Promise<ArchivoAdjunto>;
  responder(mensajeId: string, entrada: RespuestaEntrada): Promise<void>;
  categorizar(mensajeId: string, categoria: string): Promise<void>;
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
