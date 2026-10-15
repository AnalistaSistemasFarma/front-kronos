/**
 * Acuse automático en el hilo (Nicolás Rivera, 2026-10-15 12:02): al crear (o vincular)
 * una solicitud desde un correo, se responde en ese MISMO hilo, desde el buzón de la
 * persona, confirmando el número del caso y el enlace de seguimiento.
 *
 * Módulo PURO (sin servidor): lo usan el servicio para el texto real y la simulación
 * del navegador para la vista previa. Para cambiar la redacción basta con editar
 * ACUSE_PLANTILLAS; una empresa (p. ej. Jurídica de OLP) puede tener la suya en
 * ACUSE_PLANTILLA_POR_EMPRESA.
 *
 * Variables de la plantilla: {id}, {titulo}, {enlace}, {firma}.
 */

export const ACUSE_PLANTILLAS = {
  predeterminada: [
    'Cordial saludo.',
    '',
    'Les informamos que a partir de este hilo de correo se creó la solicitud #{id} — {titulo} en SynerLink.',
    '',
    'El seguimiento se hará por SynerLink: {enlace}',
    '',
    'Si necesitan agregar información, respondan a este mismo correo y quedará como nota de la solicitud.',
    '',
    'Quedamos atentos.',
    '',
    '{firma}',
  ].join('\n'),
} as const satisfies Record<string, string>;

/** Rótulo de la casilla y del botón (Nicolás, 2026-10-15 14:23: «informar a todos»). */
export const ACUSE_ETIQUETA = 'Informar en el hilo a todos los participantes';

/**
 * Opciones con las que la interfaz informa en el hilo: SIEMPRE «Responder a todos» y con los
 * participantes externos incluidos (la casilla/botón dice explícitamente «a todos los participantes»).
 */
export const ACUSE_A_TODOS: OpcionesAcuse = { enviar: true, todos: true, confirmarExterno: true };

export type ClavePlantillaAcuse = keyof typeof ACUSE_PLANTILLAS;

/** Plantilla por empresa (id_company → clave). Vacío: todas usan la predeterminada. */
export const ACUSE_PLANTILLA_POR_EMPRESA: Readonly<Record<number, ClavePlantillaAcuse>> = {};

/** Ruta (relativa) de la solicitud en SynerLink. */
export function rutaSolicitud(idRequest: number): string {
  return `/process/request-general/view-request?id=${idRequest}&from=general-requests`;
}

/** URL absoluta de la solicitud con la base del ambiente (sin barra final). */
export function enlaceSolicitud(base: string, idRequest: number): string {
  return `${String(base ?? '').trim().replace(/\/+$/, '')}${rutaSolicitud(idRequest)}`;
}

export function plantillaAcuse(idCompany?: number | null): string {
  const clave = (idCompany != null && ACUSE_PLANTILLA_POR_EMPRESA[idCompany]) || 'predeterminada';
  return ACUSE_PLANTILLAS[clave];
}

/** Texto del acuse (texto plano; Graph lo convierte a HTML escapado con saltos <br>). */
export function textoAcuse(p: { id: number | string; titulo: string; enlace: string; firma: string; idCompany?: number | null }): string {
  const valores: Record<string, string> = {
    id: String(p.id),
    titulo: String(p.titulo ?? '').replace(/\s+/g, ' ').trim(),
    enlace: p.enlace,
    firma: String(p.firma ?? '').trim(),
  };
  return plantillaAcuse(p.idCompany)
    .replace(/\{(id|titulo|enlace|firma)\}/g, (_, k: string) => valores[k])
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Opciones del acuse que manda el navegador por fila (o al vincular). */
export interface OpcionesAcuse {
  enviar: boolean;
  /** «Responder a todos» en vez de solo al remitente. */
  todos: boolean;
  /** Confirmación explícita para enviar a destinatarios externos al grupo. */
  confirmarExterno: boolean;
}

export const ACUSE_POR_DEFECTO: OpcionesAcuse = { enviar: false, todos: false, confirmarExterno: false };

/** Lee las opciones del cuerpo; si no vienen, NO se envía (las API sin la casilla no responden solas). */
export function parseOpcionesAcuse(v: unknown): OpcionesAcuse {
  if (!v || typeof v !== 'object') return { ...ACUSE_POR_DEFECTO };
  const b = v as Record<string, unknown>;
  return { enviar: b.enviar === true, todos: b.todos === true, confirmarExterno: b.confirmarExterno === true };
}

/** Clave de idempotencia (dbo.email_thread_message.internet_message_id): una por solicitud y hilo. */
export function claveAcuse(idRequest: number, idLink: number): string {
  return `synerlink-acuse:${idRequest}:${idLink}`;
}
