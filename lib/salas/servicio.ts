import 'server-only';
import {
  MENSAJE_SOLO_LECTURA,
  credencialesGraph,
  esSoloLectura,
  salasDelAmbiente,
  type GraphCredenciales,
  type Sala,
} from './config';
import { ZONA_GRAPH, esFecha, hoyBogota, msBogota } from './fechas';
import {
  borrarEvento,
  calendarView,
  crearEvento,
  esPrivado,
  horasLocales,
  leerEvento,
  ocupa,
  type EventoGraph,
} from './graph';
import { puedeCancelar, puedeReservar, type NivelSalas } from './permisos';
import {
  ErrorReserva,
  detectarChoques,
  exigirEscritura,
  expandirFechas,
  ocurrencias,
  parseInvitados,
  patronGraph,
  validarNoPasado,
  validarSolicitud,
  validarVentana,
  type EventoExistente,
  type SolicitudReserva,
} from './reglas';

/**
 * Casos de uso del módulo de Salas (SOLO servidor). Las rutas de app/api/salas
 * resuelven la sesión y el nivel; aquí se arma todo lo demás.
 */

export interface EventoSala {
  /** iCalUId: con la fecha identifica la ocurrencia. */
  id: string;
  horaInicio: string;
  horaFin: string;
  asunto: string;
  organizador: string | null;
  privado: boolean;
  serie: boolean;
  /** El usuario de la sesión puede cancelarlo (organizador o administrador). */
  cancelable: boolean;
}

export interface OcupacionSala {
  id: string;
  nombre: string;
  eventos: EventoSala[];
  error: string | null;
}

interface Contexto {
  cred: GraphCredenciales;
  salas: Sala[];
}

/** Configuración del ambiente; ErrorReserva 503 si falta algo. */
export function contexto(): Contexto {
  const cred = credencialesGraph();
  const salas = salasDelAmbiente();
  if (!cred || salas.length === 0) {
    throw new ErrorReserva('El módulo de salas no está configurado en este ambiente.', 503);
  }
  return { cred, salas };
}

function salaPorId(salas: Sala[], id: string): Sala {
  const sala = salas.find((s) => s.id === String(id ?? '').trim().toLowerCase());
  if (!sala) throw new ErrorReserva('La sala no existe.', 404);
  return sala;
}

function esSerie(e: EventoGraph): boolean {
  const t = (e.type ?? '').toLowerCase();
  return t === 'occurrence' || t === 'exception' || t === 'seriesmaster' || Boolean(e.seriesMasterId);
}

function correoOrganizador(e: EventoGraph): string {
  return (e.organizer?.emailAddress?.address ?? '').trim().toLowerCase();
}

/** Evento visible para el día: recorta los que empiezan antes o terminan después. */
function aEventoSala(e: EventoGraph, dia: string, correoSesion: string, nivel: NivelSalas | null): EventoSala {
  const h = horasLocales(e);
  const privado = esPrivado(e);
  return {
    id: e.iCalUId ?? e.id,
    horaInicio: h.fecha < dia ? '00:00' : h.horaInicio,
    horaFin: h.fechaFin > dia ? '24:00' : h.horaFin,
    asunto: privado ? 'Ocupado' : (e.subject ?? '').trim() || '(sin asunto)',
    organizador: privado ? null : e.organizer?.emailAddress?.name?.trim() || null,
    privado,
    serie: esSerie(e),
    cancelable: Boolean(e.iCalUId) && puedeCancelar(nivel, correoSesion, correoOrganizador(e)),
  };
}

/** Ocupación de todas las salas en un día. Si una sala falla, las demás se muestran igual. */
export async function ocupacionDelDia(
  fecha: string,
  correoSesion: string,
  nivel: NivelSalas | null
): Promise<OcupacionSala[]> {
  if (!esFecha(fecha)) throw new ErrorReserva('La fecha no es válida.');
  const { cred, salas } = contexto();
  return Promise.all(
    salas.map(async (sala) => {
      try {
        const eventos = (await calendarView(cred, sala.buzon, fecha))
          .filter(ocupa)
          .map((e) => aEventoSala(e, fecha, correoSesion, nivel))
          .sort((a, b) => a.horaInicio.localeCompare(b.horaInicio) || a.horaFin.localeCompare(b.horaFin));
        return { id: sala.id, nombre: sala.nombre, eventos, error: null };
      } catch (err) {
        console.error(`[salas] ocupación de ${sala.id}:`, err instanceof Error ? err.message : err);
        return { id: sala.id, nombre: sala.nombre, eventos: [], error: 'No se pudo leer el calendario de esta sala.' };
      }
    })
  );
}

function aExistente(e: EventoGraph): EventoExistente {
  const h = horasLocales(e);
  return {
    inicioMs: msBogota(h.fecha, h.horaInicio),
    finMs: msBogota(h.fechaFin, h.horaFin),
    asunto: esPrivado(e) ? 'Ocupado' : (e.subject ?? '').trim() || '(sin asunto)',
    fecha: h.fecha,
    horaInicio: h.horaInicio,
    horaFin: h.horaFin,
  };
}

function cuerpoEvento(
  s: SolicitudReserva,
  sala: Sala,
  invitados: string[],
  fecha: string,
  recurrencia: Record<string, unknown> | null,
  hasta: string | null
): Record<string, unknown> {
  return {
    subject: s.asunto.trim(),
    start: { dateTime: `${fecha}T${s.horaInicio}:00`, timeZone: ZONA_GRAPH },
    end: { dateTime: `${fecha}T${s.horaFin}:00`, timeZone: ZONA_GRAPH },
    location: { displayName: sala.nombre, locationEmailAddress: sala.buzon, locationType: 'conferenceRoom' },
    attendees: [
      { type: 'resource', emailAddress: { address: sala.buzon, name: sala.nombre } },
      ...invitados
        .filter((c) => c !== sala.buzon)
        .map((c) => ({ type: 'required', emailAddress: { address: c } })),
    ],
    ...(recurrencia && hasta
      ? {
          recurrence: {
            pattern: recurrencia,
            range: { type: 'endDate', startDate: fecha, endDate: hasta, recurrenceTimeZone: ZONA_GRAPH },
          },
        }
      : {}),
  };
}

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Respuesta de la sala (accepted/declined/none…) a un evento del organizador. */
async function respuestaSala(cred: GraphCredenciales, organizador: string, id: string, buzon: string) {
  const ev = await leerEvento(cred, organizador, id);
  const sala = (ev.attendees ?? []).find((a) => (a.emailAddress?.address ?? '').toLowerCase() === buzon);
  return (sala?.status?.response ?? 'none').toLowerCase();
}

export interface ResultadoReserva {
  creadas: number;
  pendienteConfirmacion: boolean;
}

/**
 * Crea una reserva simple o periódica en el calendario del USUARIO DE LA
 * SESIÓN (nunca un organizador enviado por el cliente), con la sala como
 * recurso. Valida todo antes de escribir: campos, tope de 1 año, ventana,
 * choques de toda la serie y modo de solo lectura.
 */
export async function reservar(
  correoSesion: string,
  nivel: NivelSalas | null,
  s: SolicitudReserva,
  ahora: Date = new Date()
): Promise<ResultadoReserva> {
  if (!puedeReservar(nivel)) throw new ErrorReserva('No tiene permiso para reservar salas.', 403);
  validarSolicitud(s);
  const { cred, salas } = contexto();
  const sala = salaPorId(salas, s.salaId);
  const invitados = parseInvitados(s.invitados);
  const fechas = expandirFechas(s.fecha, s.repeticion ?? { tipo: 'ninguna' });
  const ocs = ocurrencias(fechas, s.horaInicio, s.horaFin);
  validarNoPasado(ocs, ahora.getTime());
  validarVentana(fechas, hoyBogota(ahora), sala.ventanaDias, sala.nombre);

  const existentes = (await calendarView(cred, sala.buzon, fechas[0], fechas[fechas.length - 1]))
    .filter(ocupa)
    .map(aExistente);
  const choques = detectarChoques(ocs, existentes);
  if (choques.length > 0) {
    throw new ErrorReserva(
      fechas.length > 1
        ? `La sala ya está ocupada en ${new Set(choques.map((c) => c.fecha)).size} de las fechas de la serie. No se creó nada.`
        : 'La sala ya está ocupada en ese horario.',
      409,
      { codigo: 'CHOQUE', choques: choques.slice(0, 100) }
    );
  }

  exigirEscritura(esSoloLectura(), MENSAJE_SOLO_LECTURA);

  const organizador = correoSesion.trim().toLowerCase();
  const tipo = s.repeticion?.tipo ?? 'ninguna';
  const patron = tipo === 'ninguna' || tipo === 'especificos' ? null : patronGraph(s.fecha, s.repeticion);
  const cuerpos = patron
    ? [cuerpoEvento(s, sala, invitados, s.fecha, patron, s.repeticion.hasta ?? null)]
    : fechas.map((f) => cuerpoEvento(s, sala, invitados, f, null, null));

  const creados: string[] = [];
  const deshacer = async () => {
    for (const id of creados) {
      try {
        await borrarEvento(cred, organizador, id);
      } catch (err) {
        console.error('[salas] no se pudo deshacer un evento:', err instanceof Error ? err.message : err);
      }
    }
  };

  try {
    for (const cuerpo of cuerpos) {
      const ev = await crearEvento(cred, organizador, cuerpo);
      creados.push(ev.id);
    }
  } catch (err) {
    await deshacer();
    throw err;
  }

  // La sala responde en segundos (aceptación automática). Si rechaza, se deshace todo.
  let pendiente = false;
  for (let intento = 0; intento < 3; intento++) {
    await espera(2000);
    const respuestas = await Promise.all(
      creados.slice(0, 5).map((id) => respuestaSala(cred, organizador, id, sala.buzon).catch(() => 'none'))
    );
    if (respuestas.some((r) => r === 'declined')) {
      await deshacer();
      throw new ErrorReserva(
        `${sala.nombre} rechazó la reserva (puede ser por la ventana de reserva o un cruce). Se deshizo todo; no quedó nada creado.`,
        409,
        { codigo: 'RECHAZADA' }
      );
    }
    pendiente = respuestas.some((r) => r !== 'accepted');
    if (!pendiente) break;
  }
  return { creadas: creados.length, pendienteConfirmacion: pendiente };
}

/**
 * Cancela «solo este día» o «toda la serie». La ocurrencia se identifica por
 * iCalUId + fecha y se busca en el calendarView del ORGANIZADOR (GET
 * /events?$filter=iCalUId no devuelve ocurrencias de una serie).
 */
export async function cancelar(
  correoSesion: string,
  nivel: NivelSalas | null,
  params: { salaId: string; iCalUId: string; fecha: string; alcance: 'dia' | 'serie' }
): Promise<void> {
  if (!nivel) throw new ErrorReserva('No tiene acceso al módulo de salas.', 403);
  if (!esFecha(params.fecha)) throw new ErrorReserva('La fecha no es válida.');
  if (!params.iCalUId) throw new ErrorReserva('Falta la reunión.');
  const { cred, salas } = contexto();
  const sala = salaPorId(salas, params.salaId);

  const enSala = (await calendarView(cred, sala.buzon, params.fecha)).find((e) => e.iCalUId === params.iCalUId);
  if (!enSala) throw new ErrorReserva('No se encontró la reunión en la sala para esa fecha.', 404);
  const organizador = correoOrganizador(enSala);
  if (!organizador || !puedeCancelar(nivel, correoSesion, organizador)) {
    throw new ErrorReserva('Solo el organizador o un administrador del módulo puede cancelar esta reunión.', 403);
  }

  exigirEscritura(esSoloLectura(), MENSAJE_SOLO_LECTURA);

  const propio = (await calendarView(cred, organizador, params.fecha)).find((e) => e.iCalUId === params.iCalUId);
  if (!propio) throw new ErrorReserva('No se encontró la reunión en el calendario del organizador.', 404);
  const id = params.alcance === 'serie' && propio.seriesMasterId ? propio.seriesMasterId : propio.id;
  await borrarEvento(cred, organizador, id);
}
