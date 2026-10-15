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
    sincronizacionAutomatica: boolean;
  };
}

export type MensajeLista = MensajeResumen & { solicitud: number | null };

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

export class CorreoApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string
  ) {
    super(message);
  }
}

async function leer<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const msg = typeof body.error === 'string' ? body.error : res.status === 401 ? 'Su sesión expiró.' : `Error ${res.status}`;
    throw new CorreoApiError(msg, res.status, typeof body.code === 'string' ? body.code : undefined);
  }
  return body as T;
}

const get = <T>(url: string) => fetch(url, { cache: 'no-store' }).then((r) => leer<T>(r));
const post = <T>(url: string, body: unknown) =>
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => leer<T>(r));

export const correoApi = {
  estado: () => get<EstadoCorreo>('/api/correo'),
  carpetas: () => get<{ carpetas: Carpeta[] }>('/api/correo/carpetas'),
  mensajes: (params: Record<string, string>) => get<{ mensajes: MensajeLista[]; siguiente: string | null }>(`/api/correo/mensajes?${new URLSearchParams(params)}`),
  hilo: (id: string, remotas = false) => get<{ hilo: HiloVista }>(`/api/correo/hilo?${new URLSearchParams({ id, ...(remotas ? { remotas: '1' } : {}) })}`),
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
  responder: async (p: { mensajeId: string; texto: string; todos: boolean; archivos: File[] }) => {
    const fd = new FormData();
    fd.set('mensajeId', p.mensajeId);
    fd.set('texto', p.texto);
    if (p.todos) fd.set('todos', '1');
    for (const f of p.archivos) fd.append('files', f, f.name);
    return leer<{ ok: boolean; notaEnSolicitud: number | null }>(await fetch('/api/correo/responder', { method: 'POST', body: fd }));
  },
};

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
