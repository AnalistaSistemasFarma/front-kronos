'use client';

import { rutaSolicitud, type OpcionesAcuse } from '../../lib/correo/acuse';
import type { AdjuntoInfo, Carpeta, Direccion, FilaSimulacion, MensajeResumen, ResultadoAcuse, ResultadoCreacion, VinculoHilo } from '../../lib/correo/types';

/** Cliente del navegador para /api/correo/**. Nunca envía un buzón: el servidor usa el de la sesión. */

export interface EstadoCorreo {
  usuario: { id: string; nombre: string; email: string };
  /** Empresas donde puede crear solicitudes (las mismas de «Nueva solicitud»). */
  empresas: Array<{ idCompany: number; companyName: string }>;
  /** Empresa del módulo Correo (la predeterminada al abrir). */
  empresaBuzon?: number | null;
  conexion: {
    modo: 'off' | 'mock' | 'graph';
    /** ¿Su empresa (inquilino) ya tiene el módulo habilitado? */
    disponible: boolean;
    correo: string;
    envioHabilitado: boolean;
    etiquetarHabilitado: boolean;
    /** Eliminar (mover a Elementos eliminados con «Deshacer»): escritura y CORREO_ELIMINAR_HABILITADO. */
    eliminarHabilitado?: boolean;
    sincronizacionAutomatica: boolean;
  };
  /** Dominios del grupo (Redactar marca en amarillo a los destinatarios externos). */
  dominiosGrupo?: string[];
}

/** Sugerencia del autocompletado de Redactar. */
export interface SugerenciaDestinatario {
  nombre: string;
  correo: string;
  origen: 'reciente' | 'directorio';
}

/** `proyectos`: proyectos del chat donde se vinculó el hilo (se avisa antes de eliminarlo). */
export type MensajeLista = MensajeResumen & { solicitud: number | null; proyectos?: string[] };

/** Hilo vinculado que se iba a eliminar (409 VINCULADO): se pide confirmación. */
export interface VinculoEliminar {
  mensajeId: string;
  conversationId: string;
  idRequest: number | null;
  proyectos: string[];
}

export interface ResultadoEliminar {
  /** id pedido → id nuevo en Elementos eliminados (Graph cambia el id al mover). */
  eliminados: Array<{ id: string; nuevoId: string }>;
  yaEnEliminados: string[];
  fallidos: string[];
  /** Comprobante firmado por el servidor para «Deshacer». */
  deshacer: string | null;
  venceEn: string | null;
}

export interface MensajeVista {
  id: string;
  internetMessageId: string;
  asunto: string;
  de: Direccion;
  para: Direccion[];
  cc: Direccion[];
  fecha: string;
  leido: boolean;
  html: string;
  remotasBloqueadas: number;
  adjuntos: AdjuntoInfo[];
  enCaso: boolean;
  /** «Abrir en Outlook» (validado en el servidor: solo https de Outlook en la web). */
  enlaceOutlook: string | null;
  /** Imágenes incrustadas aún sin descargar: se piden al desplegar el mensaje (correoApi.imagenes). */
  imagenesPendientes?: boolean;
}

export interface HiloVista {
  conversationId: string;
  asunto: string;
  mensajes: MensajeVista[];
  vinculo: (VinculoHilo & { lastSyncedAt: string | null }) | null;
  pendientes: number;
}

export interface ProcesoCorreo {
  id: number;
  nombre: string;
  descripcion?: string | null;
  idCategoria?: number;
  categoria?: string;
  responsables?: string[];
}

export interface CategoriaCorreo {
  id: number;
  categoria: string;
}

/** Agente del chat que la persona puede usar (los mismos del chat). */
export interface AgenteCorreo {
  idAgent: number;
  code: string;
  displayName: string;
  avatarUrl: string | null;
  avatarVersion: number | null;
  description: string | null;
}

/** Acceso vigente de un agente a un hilo. */
export interface ConcesionCorreo {
  id: number;
  agente: { idAgent: number; code: string; displayName: string };
  creadaEn: string;
  venceEn: string;
  idChatConversation: number;
}

/** Propuesta del agente (tarjeta del chat). Espejo de AccionVista (lib/correo/agente.ts). */
export interface AccionAgenteCorreo {
  id: number;
  tipo: 'RESPUESTA' | 'SOLICITUD' | 'NOTA';
  estado: 'PENDIENTE' | 'EJECUTANDO' | 'CONFIRMADA' | 'DESCARTADA' | 'FALLIDA';
  idChatMessage: number | null;
  creadaEn: string;
  decididaEn: string | null;
  resultado: string | null;
  idRequest: number | null;
  asunto: string;
  agente: string;
  vigente: boolean;
  estadoConcesion: 'VIGENTE' | 'VENCIDA' | 'REVOCADA';
  venceEn: string;
  respuesta?: { cuerpo: string; html: string; todos: boolean; para: string[] };
  solicitud?: { proceso: string | null; categoria: string | null; titulo: string; descripcion: string };
  nota?: { texto: string; idRequest: number | null };
}

export interface PreparacionSolicitudAgente {
  empresas: Array<{ idCompany: number; companyName: string }>;
  idCompany: number;
  categorias: CategoriaCorreo[];
  procesos: ProcesoCorreo[];
  idProcess: number | null;
  idSolicitante: string | null;
  solicitanteNombre: string | null;
  alertas: string[];
  duplicadoDe: number | null;
  titulo: string;
  descripcion: string;
  adjuntos: number;
}

export class CorreoApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    /** Solicitud relacionada (en un DUPLICADO: la que ya tiene este correo). */
    public readonly idRequest?: number
  ) {
    super(message);
  }
}

async function leer<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const msg = typeof body.error === 'string' ? body.error : res.status === 401 ? 'Su sesión expiró.' : `Error ${res.status}`;
    throw new CorreoApiError(msg, res.status, typeof body.code === 'string' ? body.code : undefined, typeof body.idRequest === 'number' ? body.idRequest : undefined);
  }
  return body as T;
}

const get = <T>(url: string, signal?: AbortSignal) => fetch(url, { cache: 'no-store', signal }).then((r) => leer<T>(r));
const post = <T>(url: string, body: unknown) =>
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => leer<T>(r));

export const correoApi = {
  estado: () => get<EstadoCorreo>('/api/correo'),
  carpetas: (signal?: AbortSignal) => get<{ carpetas: Carpeta[] }>('/api/correo/carpetas', signal),
  mensajes: (params: Record<string, string>, signal?: AbortSignal) =>
    get<{ mensajes: MensajeLista[]; siguiente: string | null }>(`/api/correo/mensajes?${new URLSearchParams(params)}`, signal),
  /** `fresco` («Actualizar») ignora la caché corta del servidor. */
  hilo: (id: string, remotas = false, signal?: AbortSignal, fresco = false) =>
    get<{ hilo: HiloVista }>(`/api/correo/hilo?${new URLSearchParams({ id, ...(remotas ? { remotas: '1' } : {}), ...(fresco ? { fresco: '1' } : {}) })}`, signal),
  /** Un mensaje del hilo con sus imágenes incrustadas (al desplegarlo). */
  imagenes: (hilo: string, id: string, remotas = false) =>
    get<{ mensaje: MensajeVista }>(`/api/correo/hilo/imagenes?${new URLSearchParams({ hilo, id, ...(remotas ? { remotas: '1' } : {}) })}`),
  marcarLeido: (conversationId: string, leido: boolean) => post<{ cambiados: number }>('/api/correo/hilo/leido', { conversationId, leido }),
  marcarSeleccion: (mensajesIds: string[], leido: boolean) => post<{ cambiados: number; fallidos: number }>('/api/correo/leido', { mensajesIds, leido }),
  /** Un lote de «Marcar todo» (200): repetir mientras `restantes` > 0. carpeta null = Bandeja de entrada. */
  marcarCarpeta: (carpeta: string | null, leido: boolean) =>
    post<{ cambiados: number; fallidos: number; restantes: number }>('/api/correo/leido/carpeta', { carpeta, leido }),
  /**
   * Eliminar = MOVER a Elementos eliminados (nunca borra). Si algún hilo está vinculado y no se confirmó, el
   * servidor responde 409 VINCULADO y aquí se devuelve `{ vinculados }` para pedir la confirmación.
   */
  eliminar: async (mensajesIds: string[], confirmarVinculados = false): Promise<{ resultado: ResultadoEliminar } | { vinculados: VinculoEliminar[] }> => {
    const res = await fetch('/api/correo/eliminar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mensajesIds, confirmarVinculados }) });
    if (res.status === 409) {
      const b = (await res.clone().json().catch(() => ({}))) as { code?: string; vinculos?: VinculoEliminar[] };
      if (b.code === 'VINCULADO' && Array.isArray(b.vinculos)) return { vinculados: b.vinculos };
    }
    return { resultado: await leer<ResultadoEliminar>(res) };
  },
  /** «Deshacer» del aviso: devuelve a su carpeta los correos del comprobante. */
  deshacerEliminar: (deshacer: string) => post<{ restaurados: Array<{ id: string; nuevoId: string }>; fallidos: string[] }>('/api/correo/eliminar/deshacer', { deshacer }),
  notas: (conversationId: string) => post<{ agregadas: number; idRequest: number }>('/api/correo/hilo/notas', { conversationId }),
  vincular: (conversationId: string, idRequest: number, acuse?: OpcionesAcuse) =>
    post<{ vinculo: VinculoHilo; acuse?: ResultadoAcuse }>('/api/correo/hilo/vincular', { conversationId, idRequest, ...(acuse ? { acuse } : {}) }),
  /** «Reintentar respuesta»: acuse del hilo ya vinculado (idempotente en el servidor). */
  reintentarAcuse: (conversationId: string, todos: boolean, confirmarExterno: boolean) =>
    post<{ acuse: ResultadoAcuse }>('/api/correo/acuse', { conversationId, todos, confirmarExterno }),
  simular: (mensajesIds: string[], empresa: number, procesoPredeterminado: number | null) =>
    post<{ filas: FilaSimulacion[]; categorias: CategoriaCorreo[]; procesos: ProcesoCorreo[] }>('/api/correo/simular', { mensajesIds, empresa, procesoPredeterminado }),
  crear: (fila: Record<string, unknown>) => post<ResultadoCreacion>('/api/correo/crear', fila),
  usuarios: (empresa: number, q: string) => get<{ usuarios: Array<{ id: string; nombre: string; correo: string }> }>(`/api/correo/usuarios?${new URLSearchParams({ empresa: String(empresa), q })}`),
  procesos: (empresa: number) => get<{ categorias: CategoriaCorreo[]; procesos: ProcesoCorreo[] }>(`/api/correo/procesos?empresa=${empresa}`),
  vinculos: (idRequest: number) => get<{ vinculos: VinculoHilo[] }>(`/api/correo/vinculos?solicitud=${idRequest}`),
  // «Consultar a un agente» (2026-10-16): compartir el hilo con un agente del chat y decidir sus propuestas.
  agentes: () => get<{ agentes: AgenteCorreo[] }>('/api/correo/agente/agentes'),
  compartir: (conversationId: string, idAgent: number, pregunta: string) =>
    post<{ idShare: number; idChatConversation: number; agente: AgenteCorreo; venceEn: string }>('/api/correo/agente/compartir', { conversationId, idAgent, pregunta }),
  compartidos: (conversationId: string) => get<{ compartidos: ConcesionCorreo[] }>(`/api/correo/agente/compartidos?${new URLSearchParams({ conversationId })}`),
  revocar: (id: number) => post<{ revocada: boolean }>('/api/correo/agente/revocar', { id }),
  acciones: (chat: number, signal?: AbortSignal) => get<{ acciones: AccionAgenteCorreo[] }>(`/api/correo/agente/acciones?chat=${chat}`, signal),
  prepararSolicitudAgente: (id: number, empresa?: number | null) =>
    get<PreparacionSolicitudAgente>(`/api/correo/agente/acciones/${id}/preparar${empresa ? `?empresa=${empresa}` : ''}`),
  confirmarAccion: (id: number, edicion: Record<string, unknown> = {}) =>
    post<{ estado: string; resultado: string; idRequest: number | null }>(`/api/correo/agente/acciones/${id}`, { op: 'confirmar', ...edicion }),
  descartarAccion: (id: number) => post<{ estado: string; resultado: string }>(`/api/correo/agente/acciones/${id}`, { op: 'descartar' }),
  /** Autocompletado de Redactar: recientes de la persona y directorio de la organización. */
  destinatarios: (q: string, signal?: AbortSignal) => get<{ destinatarios: SugerenciaDestinatario[] }>(`/api/correo/destinatarios?${new URLSearchParams({ q })}`, signal),
  /** Correo NUEVO desde el buzón propio (el servidor usa el de la sesión; aquí no se manda remitente). */
  redactar: async (p: { para: string[]; cc: string[]; cco: string[]; asunto: string; texto: string; archivos: File[] }) => {
    const fd = new FormData();
    fd.set('para', JSON.stringify(p.para));
    fd.set('cc', JSON.stringify(p.cc));
    fd.set('cco', JSON.stringify(p.cco));
    fd.set('asunto', p.asunto);
    fd.set('texto', p.texto);
    for (const f of p.archivos) fd.append('files', f, f.name);
    return leer<{ ok: boolean; destinatarios: number }>(await fetch('/api/correo/redactar', { method: 'POST', body: fd }));
  },
  responder: async (p: { mensajeId: string; texto: string; todos: boolean; archivos: File[] }) => {
    const fd = new FormData();
    fd.set('mensajeId', p.mensajeId);
    fd.set('texto', p.texto);
    if (p.todos) fd.set('todos', '1');
    for (const f of p.archivos) fd.append('files', f, f.name);
    return leer<{ ok: boolean; notaEnSolicitud: number | null }>(await fetch('/api/correo/responder', { method: 'POST', body: fd }));
  },
};

/** ¿El error es de una consulta cancelada a propósito (el usuario ya cambió de carpeta o de hilo)? */
export const esCancelada = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

export const urlAdjunto = (mensajeId: string, adjuntoId: string, ver = false) =>
  `/api/correo/adjunto?${new URLSearchParams({ mensaje: mensajeId, adjunto: adjuntoId, ...(ver ? { ver: '1' } : {}) })}`;

export const urlSolicitud = (id: number) => rutaSolicitud(id);

export const PREVISUALIZABLES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'application/pdf']);

export function fechaCorta(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const hoy = new Date();
  const mismoDia = d.toDateString() === hoy.toDateString();
  return mismoDia
    ? d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: d.getFullYear() === hoy.getFullYear() ? undefined : 'numeric' });
}

export function fechaLarga(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });
}

export function tamano(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}
