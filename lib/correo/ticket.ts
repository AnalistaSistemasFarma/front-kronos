import { CORREO_MAX_ADJUNTO_BYTES, CORREO_MAX_DESCRIPCION } from './constants';
import * as data from './db';
import type { AccesoCorreo } from './db';
import { CorreoError } from './errors';
import { descripcionDesdeCorreo, normalizarAsunto } from './rules';
import { proveedorDe, puedeUsarEmpresa, type CorreoDeps } from './service';
import type { ArchivoAdjunto, Direccion, MensajeCompleto } from './types';

/**
 * «Crear ticket» desde un hilo del Correo (pedido de Nicolás Rivera, 2026-10-21: «solo para los
 * de TI: que desde el módulo de correo puedan crear un ticket, igual como lo hacen con la
 * solicitud, pero ahora un ticket»).
 *
 * «De TI» = técnico del roster de mesa de ayuda (subproceso 1, lib/help-desk/technicians): el
 * MISMO criterio que ya decide quién crea casos en el tablero de tickets
 * (/process/help-desk/create-ticket). Se valida en el servidor en cada llamada; el botón del
 * navegador solo se muestra si el servidor dijo que sí.
 *
 * Igual que la solicitud: del navegador solo se aceptan los campos editables; el hilo, el
 * remitente y los adjuntos se releen del buzón de la sesión. El hilo se reserva antes de
 * insertar (un ticket por hilo y persona) y la relación queda en email_thread_case.
 */

export const TICKET_TIPOS = ['Incidente', 'Solicitud'] as const;
export const TICKET_PRIORIDADES = ['Baja', 'Media', 'Alta'] as const;
export const TICKET_SITIOS = ['Administrativa', 'Planta', 'Celta'] as const;
/** Asunto del ticket: el tablero usa 100; aquí cabe además «Remitente - » (columna NVARCHAR(1000)). */
export const TICKET_MAX_ASUNTO = 200;
export const TICKET_MAX_DESCRIPCION = CORREO_MAX_DESCRIPCION;

export interface OpcionTicket {
  id: number;
  nombre: string;
}
export interface TecnicoTicket extends OpcionTicket {
  correo: string;
}
export interface CatalogoTicket {
  categorias: OpcionTicket[];
  departamentos: OpcionTicket[];
  tecnicos: TecnicoTicket[];
}
export interface ClasificacionTicket {
  categoria: number;
  subcategoria: number;
  actividad: number;
  departamento: number;
  tecnico: number | null;
}
export interface CasoNuevo extends ClasificacionTicket {
  idCompany: number;
  asunto: string;
  descripcion: string;
  tipo: string;
  prioridad: string;
  sitio: string;
  /** [case].requester = id_company_user (convención de la mesa de ayuda). */
  requester: number;
  /** [case].email: correo de contacto (el remitente del hilo). */
  correoContacto: string | null;
}

export interface TicketPort {
  esTecnico(email: string): Promise<boolean>;
  catalogo(): Promise<CatalogoTicket>;
  validarClasificacion(c: ClasificacionTicket): Promise<string | null>;
  companyUser(idUser: string, idCompany: number): Promise<number | null>;
  casoExiste(idCase: number): Promise<boolean>;
  crearCaso(p: CasoNuevo): Promise<number>;
  /** Sube los adjuntos a la carpeta del ticket en OneDrive (TEC/MA/Ticket-<id>). */
  subirAdjuntos(idCase: number, archivos: ArchivoAdjunto[]): Promise<{ subidos: number; fallidos: string[] }>;
}

/** ¿Puede crear tickets desde el Correo? Sin el puerto configurado, nunca. */
export async function puedeCrearTicket(d: CorreoDeps, acceso: AccesoCorreo): Promise<boolean> {
  if (!d.ticket) return false;
  try {
    return await d.ticket.esTecnico(acceso.email);
  } catch {
    return false;
  }
}

/** 403 si la persona no es de TI (técnico de mesa de ayuda). Devuelve el puerto ya validado. */
export async function exigirTI(d: CorreoDeps, acceso: AccesoCorreo): Promise<TicketPort> {
  if (!d.ticket || !(await puedeCrearTicket(d, acceso))) {
    throw new CorreoError('Crear tickets desde el Correo es solo para el equipo de TI (técnicos de la mesa de ayuda).', 403, 'SOLO_TI');
  }
  return d.ticket;
}

export interface AdjuntoTicket {
  id: string;
  mensajeId: string;
  nombre: string;
  tamano: number;
}

export interface PreparacionTicket extends CatalogoTicket {
  conversationId: string;
  mensajeId: string;
  remitente: Direccion;
  /** Usuario de SynerLink del remitente (si existe): será el solicitante. */
  solicitante: { id: string; nombre: string; empresas: number[] } | null;
  empresas: Array<{ idCompany: number; companyName: string }>;
  idCompany: number | null;
  asunto: string;
  descripcion: string;
  adjuntos: AdjuntoTicket[];
  /** Técnico sugerido: la propia persona (está en el roster). */
  idTecnico: number | null;
  /** Ticket ya creado desde este hilo (no se crea otro). */
  ticketExistente: number | null;
  tipos: readonly string[];
  prioridades: readonly string[];
  sitios: readonly string[];
}

/** Primer correo del hilo que no es de la persona (el que pidió); si no hay, el primero. */
export function correoDeOrigen(hilo: MensajeCompleto[], propio: string): MensajeCompleto {
  const orden = [...hilo].sort((a, b) => a.fecha.localeCompare(b.fecha));
  return orden.find((m) => m.de.correo && m.de.correo.toLowerCase() !== propio) ?? orden[0];
}

/** Asunto con la convención de la mesa de ayuda: «Nombre del solicitante - asunto». */
export function asuntoTicket(remitente: Direccion, asunto: string): string {
  const nombre = (remitente.nombre || remitente.correo || '').replace(/\s+/g, ' ').trim();
  const a = normalizarAsunto(asunto);
  return (nombre ? `${nombre} - ${a}` : a).slice(0, TICKET_MAX_ASUNTO);
}

async function ticketVigente(d: CorreoDeps, t: TicketPort, acceso: AccesoCorreo, conversationId: string): Promise<number | null> {
  const r = await data.ticketDeHilo(d.db, acceso.idUser, conversationId);
  return r && (await t.casoExiste(r.idCase)) ? r.idCase : null;
}

/** Ticket ya creado desde el hilo (para la ficha del hilo). Solo TI; tolera la tabla ausente. */
export async function ticketDelHilo(d: CorreoDeps, acceso: AccesoCorreo, conversationId: string): Promise<number | null> {
  const t = await exigirTI(d, acceso);
  try {
    return await ticketVigente(d, t, acceso, conversationId);
  } catch {
    return null;
  }
}

/** Formulario precargado con el hilo: asunto, descripción, solicitante por remitente y adjuntos. */
export async function prepararTicket(d: CorreoDeps, acceso: AccesoCorreo, conversationId: string): Promise<PreparacionTicket> {
  const t = await exigirTI(d, acceso);
  const prov = await proveedorDe(d, acceso);
  const hilo = await prov.hilo(conversationId);
  if (hilo.length === 0) throw new CorreoError('No se encontró el hilo en su buzón.', 404);
  const propio = acceso.email.toLowerCase();
  const origen = correoDeOrigen(hilo, propio);
  const [catalogo, usuarios, existente] = await Promise.all([
    t.catalogo(),
    data.usuariosPorCorreo(d.db, [origen.de.correo]),
    ticketVigente(d, t, acceso, conversationId).catch(() => null),
  ]);
  const u = usuarios.get(origen.de.correo.trim().toLowerCase()) ?? null;
  const empresas = acceso.empresasSolicitud;
  const idCompany = (u && empresas.find((e) => u.empresas.includes(e.idCompany))?.idCompany) ?? acceso.empresas[0]?.idCompany ?? empresas[0]?.idCompany ?? null;
  const tecnico = catalogo.tecnicos.find((x) => x.correo === propio) ?? null;
  return {
    ...catalogo,
    conversationId,
    mensajeId: origen.id,
    remitente: origen.de,
    solicitante: u ? { id: u.id, nombre: u.nombre, empresas: u.empresas } : null,
    empresas,
    idCompany,
    asunto: asuntoTicket(origen.de, origen.asunto),
    descripcion: descripcionDesdeCorreo(origen).slice(0, TICKET_MAX_DESCRIPCION),
    adjuntos: hilo.flatMap((m) => m.adjuntos.filter((a) => !a.enLinea).map((a) => ({ id: a.id, mensajeId: m.id, nombre: a.nombre, tamano: a.tamano }))),
    idTecnico: tecnico?.id ?? null,
    ticketExistente: existente,
    tipos: TICKET_TIPOS,
    prioridades: TICKET_PRIORIDADES,
    sitios: TICKET_SITIOS,
  };
}

export interface EntradaTicket extends ClasificacionTicket {
  conversationId: string;
  idCompany: number;
  /** Usuario de SynerLink solicitante (opcional: sin él, el ticket queda a nombre de la persona con el remitente como contacto). */
  idSolicitante: string | null;
  tipo: string;
  prioridad: string;
  sitio: string;
  asunto: string;
  descripcion: string;
  adjuntosIds: string[];
}

const GRAPH_ID_RE = /^[A-Za-z0-9+=_-]{8,512}$/;
const ID_USER_RE = /^[A-Za-z0-9_-]{1,50}$/;

/** Validación de forma del cuerpo (los catálogos se validan contra la base al crear). */
export function parseEntradaTicket(body: unknown): EntradaTicket {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const num = (v: unknown) => (v !== null && v !== '' && Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : null);
  const conversationId = String(b.conversationId ?? '');
  if (!GRAPH_ID_RE.test(conversationId)) throw new CorreoError('Correo inválido.', 400);
  const tipo = String(b.tipo ?? '');
  const prioridad = String(b.prioridad ?? '');
  const sitio = String(b.sitio ?? '');
  if (!(TICKET_TIPOS as readonly string[]).includes(tipo)) throw new CorreoError('Elija el tipo de solicitud.', 400);
  if (!(TICKET_PRIORIDADES as readonly string[]).includes(prioridad)) throw new CorreoError('Elija la prioridad.', 400);
  if (!(TICKET_SITIOS as readonly string[]).includes(sitio)) throw new CorreoError('Elija el sitio.', 400);
  const idCompany = num(b.idCompany);
  const categoria = num(b.categoria);
  const subcategoria = num(b.subcategoria);
  const actividad = num(b.actividad);
  const departamento = num(b.departamento);
  if (!idCompany) throw new CorreoError('Elija la empresa.', 400);
  if (!categoria) throw new CorreoError('Elija la categoría.', 400);
  if (!subcategoria) throw new CorreoError('Elija la subcategoría.', 400);
  if (!actividad) throw new CorreoError('Elija la actividad.', 400);
  if (!departamento) throw new CorreoError('Elija el departamento.', 400);
  const tecnico = b.tecnico == null || b.tecnico === '' ? null : num(b.tecnico);
  if (b.tecnico != null && b.tecnico !== '' && !tecnico) throw new CorreoError('Técnico inválido.', 400);
  const sol = b.idSolicitante == null || b.idSolicitante === '' ? null : String(b.idSolicitante);
  if (sol !== null && !ID_USER_RE.test(sol)) throw new CorreoError('Solicitante inválido.', 400);
  const asunto = String(b.asunto ?? '').replace(/\s+/g, ' ').trim();
  const descripcion = String(b.descripcion ?? '').trim();
  if (asunto.length < 3) throw new CorreoError('El asunto es obligatorio.', 400);
  if (descripcion.length < 10) throw new CorreoError('La descripción debe tener al menos 10 caracteres.', 400);
  const adjuntosIds = Array.isArray(b.adjuntosIds) ? [...new Set(b.adjuntosIds.map(String))].filter((x) => GRAPH_ID_RE.test(x)).slice(0, 30) : [];
  return {
    conversationId,
    idCompany,
    idSolicitante: sol,
    tipo,
    prioridad,
    sitio,
    categoria,
    subcategoria,
    actividad,
    departamento,
    tecnico,
    asunto: asunto.slice(0, TICKET_MAX_ASUNTO),
    descripcion: descripcion.slice(0, TICKET_MAX_DESCRIPCION),
    adjuntosIds,
  };
}

export interface ResultadoTicket {
  idCase: number;
  solicitante: string;
  adjuntosSubidos: number;
  adjuntosFallidos: string[];
}

/** Crea el ticket desde el hilo. Solo TI; idempotente por hilo y persona. */
export async function crearTicketDesdeHilo(d: CorreoDeps, acceso: AccesoCorreo, e: EntradaTicket, ip: string | null): Promise<ResultadoTicket> {
  const t = await exigirTI(d, acceso);
  if (!puedeUsarEmpresa(acceso, e.idCompany)) throw new CorreoError('Usted no pertenece a esa empresa.', 403);
  const motivo = await t.validarClasificacion(e);
  if (motivo) throw new CorreoError(motivo, 400);

  const prov = await proveedorDe(d, acceso);
  const hilo = await prov.hilo(e.conversationId);
  if (hilo.length === 0) throw new CorreoError('No se encontró el hilo en su buzón.', 404);
  const origen = correoDeOrigen(hilo, acceso.email.toLowerCase());

  // Solicitante: el usuario elegido (activo y de la empresa) o, si no hay, la persona (convención
  // de los casos por correo: el remitente queda como correo de contacto y en el asunto).
  let solicitante = { id: acceso.idUser, nombre: acceso.nombre };
  if (e.idSolicitante) {
    const u = await data.usuarioDeEmpresa(d.db, e.idSolicitante, e.idCompany);
    if (!u) throw new CorreoError('El solicitante no es un usuario activo de la empresa elegida.', 400);
    solicitante = { id: u.id, nombre: u.nombre };
  }
  const requester = await t.companyUser(solicitante.id, e.idCompany);
  if (!requester) throw new CorreoError('El solicitante no pertenece a la empresa elegida.', 400);

  const reserva = await data.reservarTicket(d.db, {
    idUser: acceso.idUser,
    mailbox: acceso.email.toLowerCase(),
    conversationId: e.conversationId,
    internetMessageId: origen.internetMessageId || null,
    asunto: e.asunto,
    casoExiste: (id) => t.casoExiste(id),
  });

  let idCase: number;
  try {
    idCase = await t.crearCaso({
      idCompany: e.idCompany,
      asunto: e.asunto,
      descripcion: e.descripcion,
      tipo: e.tipo,
      prioridad: e.prioridad,
      sitio: e.sitio,
      categoria: e.categoria,
      subcategoria: e.subcategoria,
      actividad: e.actividad,
      departamento: e.departamento,
      tecnico: e.tecnico,
      requester,
      correoContacto: origen.de.correo ? origen.de.correo.toLowerCase().slice(0, 320) : null,
    });
    await data.activarTicket(d.db, reserva.idReserva, idCase);
  } catch (err) {
    try {
      await data.liberarTicket(d.db, reserva.idReserva);
    } catch {
      /* la reserva queda en CREANDO y se limpia sola a los 5 min; el error original es el que importa */
    }
    throw err;
  }

  // Adjuntos (no bloquean: el ticket ya existe). Solo los del hilo, releídos del buzón.
  const permitidos = new Map(hilo.flatMap((m) => m.adjuntos.filter((a) => !a.enLinea).map((a) => [a.id, { m, a }] as const)));
  const archivos: ArchivoAdjunto[] = [];
  const fallidos: string[] = [];
  for (const idAdj of e.adjuntosIds) {
    const x = permitidos.get(idAdj);
    if (!x) continue;
    if (x.a.tamano > CORREO_MAX_ADJUNTO_BYTES) {
      fallidos.push(`${x.a.nombre}: supera 25 MB`);
      continue;
    }
    try {
      archivos.push(await prov.adjunto(x.m.id, idAdj));
    } catch (err) {
      fallidos.push(`${x.a.nombre}: ${err instanceof Error ? err.message : 'no se pudo leer'}`);
    }
  }
  let subidos = 0;
  if (archivos.length) {
    try {
      const up = await t.subirAdjuntos(idCase, archivos);
      subidos = up.subidos;
      fallidos.push(...up.fallidos);
    } catch (err) {
      fallidos.push(`OneDrive: ${err instanceof Error ? err.message : 'error'}`);
    }
  }

  await data.auditar(d.db, {
    idUser: acceso.idUser,
    mailbox: acceso.email.toLowerCase(),
    accion: 'CREAR_TICKET',
    mensajeId: origen.id,
    conversationId: e.conversationId,
    internetMessageId: origen.internetMessageId,
    detalle: `Ticket #${idCase} · empresa ${e.idCompany}, categoría ${e.categoria}/${e.subcategoria}/${e.actividad}, solicitante ${solicitante.id}, técnico ${e.tecnico ?? 'sin asignar'}, adjuntos ${subidos}/${e.adjuntosIds.length}`,
    ip,
  });
  return { idCase, solicitante: solicitante.nombre, adjuntosSubidos: subidos, adjuntosFallidos: fallidos };
}
