/**
 * Reglas puras del módulo de Salas: validación de la solicitud, expansión de
 * series, tope de 1 año, ventana de reserva y choques. Sin red ni base: se
 * prueban en lib/salas/__tests__/reglas.test.ts.
 */
import {
  diaSemana,
  diferenciaDias,
  esFecha,
  esHora,
  msBogota,
  sumarAnios,
  sumarDias,
} from './fechas';

export type TipoRepeticion = 'ninguna' | 'diaria' | 'semanal' | 'mensual' | 'anual' | 'especificos';

export interface Repeticion {
  tipo: TipoRepeticion;
  /** Diaria: solo de lunes a viernes. */
  soloHabiles?: boolean;
  /** Semanal: días de la semana (0 = domingo … 6 = sábado). Por defecto, el de la fecha de inicio. */
  diasSemana?: number[];
  /** Diaria, semanal, mensual y anual: última fecha de la serie (inclusive). */
  hasta?: string;
  /** Días específicos elegidos en el calendario (incluye o no la fecha de inicio). */
  fechas?: string[];
}

export interface SolicitudReserva {
  salaId: string;
  fecha: string;
  horaInicio: string;
  horaFin: string;
  asunto: string;
  /** Correos separados por coma (decisión de Cristian, 2026-10-06: no «;»). */
  invitados: string;
  repeticion: Repeticion;
}

export interface Ocurrencia {
  fecha: string;
  inicioMs: number;
  finMs: number;
}

export interface EventoExistente {
  inicioMs: number;
  finMs: number;
  /** Asunto visible, o «Ocupado» si el evento es privado. */
  asunto: string;
  /** Hora local de inicio y fin (HH:mm) y fecha, para mostrar. */
  fecha: string;
  horaInicio: string;
  horaFin: string;
}

export interface Choque {
  fecha: string;
  asunto: string;
  horaInicio: string;
  horaFin: string;
}

/** Máximo de ocurrencias en una serie (1 año diario = 366). */
export const MAX_OCURRENCIAS = 370;
export const MAX_INVITADOS = 50;
export const MAX_ASUNTO = 255;

const CORREO_RE = /^[^\s@,;<>"']{1,64}@[a-z0-9.-]{1,253}\.[a-z]{2,}$/i;

export class ErrorReserva extends Error {
  constructor(
    message: string,
    public readonly status: number = 400,
    public readonly detalle?: unknown
  ) {
    super(message);
    this.name = 'ErrorReserva';
  }
}

/** Separa los invitados por coma y valida cada correo. Devuelve la lista sin repetidos. */
export function parseInvitados(texto: string): string[] {
  const lista = (texto ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const invalidos = lista.filter((c) => !CORREO_RE.test(c));
  if (invalidos.length > 0) {
    throw new ErrorReserva(
      `Correo de invitado no válido: ${invalidos.slice(0, 3).join(', ')}. Separe los correos con coma.`
    );
  }
  const unicos = [...new Set(lista.map((c) => c.toLowerCase()))];
  if (unicos.length > MAX_INVITADOS) {
    throw new ErrorReserva(`Máximo ${MAX_INVITADOS} invitados por reserva.`);
  }
  return unicos;
}

/** Valida los campos básicos de la solicitud (sin tocar Graph). */
export function validarSolicitud(s: SolicitudReserva): void {
  if (!s.salaId) throw new ErrorReserva('Seleccione una sala.');
  if (!esFecha(s.fecha)) throw new ErrorReserva('La fecha no es válida.');
  if (!esHora(s.horaInicio) || !esHora(s.horaFin)) throw new ErrorReserva('La hora no es válida.');
  if (s.horaFin <= s.horaInicio) {
    throw new ErrorReserva('La hora de fin debe ser posterior a la hora de inicio.');
  }
  const asunto = (s.asunto ?? '').trim();
  if (!asunto) throw new ErrorReserva('Escriba el asunto de la reunión.');
  if (asunto.length > MAX_ASUNTO) throw new ErrorReserva(`El asunto admite máximo ${MAX_ASUNTO} caracteres.`);
}

/** Primera fecha que ya no se permite por el tope de 1 año. */
export function topeUnAnio(inicio: string): string {
  return sumarAnios(inicio, 1);
}

/**
 * Expande la repetición a la lista de fechas (ordenadas, sin repetidas).
 * Lanza ErrorReserva si la serie pasa del tope de 1 año desde la primera fecha.
 */
export function expandirFechas(inicio: string, rep: Repeticion): string[] {
  if (!esFecha(inicio)) throw new ErrorReserva('La fecha no es válida.');
  const tipo = rep?.tipo ?? 'ninguna';
  if (tipo === 'ninguna') return [inicio];

  if (tipo === 'especificos') {
    const fechas = [...new Set([inicio, ...(rep.fechas ?? [])])];
    if (fechas.some((f) => !esFecha(f))) throw new ErrorReserva('Hay una fecha no válida en los días específicos.');
    fechas.sort();
    const primera = fechas[0];
    const ultima = fechas[fechas.length - 1];
    if (ultima >= topeUnAnio(primera)) {
      throw new ErrorReserva(
        `La serie no puede pasar de 1 año: la última fecha permitida es ${sumarDias(topeUnAnio(primera), -1)}.`
      );
    }
    if (fechas.length > MAX_OCURRENCIAS) throw new ErrorReserva(`Máximo ${MAX_OCURRENCIAS} fechas por serie.`);
    return fechas;
  }

  const hasta = rep.hasta;
  if (!esFecha(hasta)) throw new ErrorReserva('Indique hasta qué fecha se repite la reunión.');
  if (hasta < inicio) throw new ErrorReserva('La fecha final de la serie debe ser posterior a la fecha de inicio.');
  if (hasta >= topeUnAnio(inicio)) {
    throw new ErrorReserva(
      `La serie no puede pasar de 1 año: la última fecha permitida es ${sumarDias(topeUnAnio(inicio), -1)}.`
    );
  }

  const fechas: string[] = [];
  const total = diferenciaDias(inicio, hasta);
  const [, mesInicio, diaInicio] = inicio.split('-').map(Number);
  const dias =
    tipo === 'semanal'
      ? new Set((rep.diasSemana?.length ? rep.diasSemana : [diaSemana(inicio)]).filter((d) => d >= 0 && d <= 6))
      : null;

  for (let i = 0; i <= total; i++) {
    const f = sumarDias(inicio, i);
    const dow = diaSemana(f);
    const [, mes, dia] = f.split('-').map(Number);
    let incluir = false;
    switch (tipo) {
      case 'diaria':
        incluir = !rep.soloHabiles || (dow >= 1 && dow <= 5);
        break;
      case 'semanal':
        incluir = dias!.has(dow);
        break;
      case 'mensual':
        // Como Graph (absoluteMonthly): si el mes no tiene ese día, se salta.
        incluir = dia === diaInicio;
        break;
      case 'anual':
        incluir = dia === diaInicio && mes === mesInicio;
        break;
      default:
        throw new ErrorReserva('Tipo de repetición no válido.');
    }
    if (incluir) fechas.push(f);
  }
  if (fechas.length === 0) throw new ErrorReserva('La repetición elegida no genera ninguna fecha.');
  if (fechas.length > MAX_OCURRENCIAS) throw new ErrorReserva(`Máximo ${MAX_OCURRENCIAS} fechas por serie.`);
  return fechas;
}

/** Ocurrencias (instantes) de una solicitud, a partir de sus fechas. */
export function ocurrencias(fechas: string[], horaInicio: string, horaFin: string): Ocurrencia[] {
  return fechas.map((fecha) => ({
    fecha,
    inicioMs: msBogota(fecha, horaInicio),
    finMs: msBogota(fecha, horaFin),
  }));
}

/**
 * Ventana de reserva (BookingWindowInDays): Exchange rechaza la serie completa
 * si termina por fuera, y una reserva simple fuera de ella puede rechazarse en
 * silencio. Devuelve la fecha máxima permitida.
 */
export function fechaMaximaVentana(hoy: string, ventanaDias: number): string {
  return sumarDias(hoy, ventanaDias);
}

export function validarVentana(fechas: string[], hoy: string, ventanaDias: number, nombreSala: string): void {
  const maxima = fechaMaximaVentana(hoy, ventanaDias);
  const ultima = fechas[fechas.length - 1];
  if (ultima > maxima) {
    throw new ErrorReserva(
      `${nombreSala} acepta reservas hasta ${ventanaDias} días adelante: la fecha máxima permitida es ${maxima}.`,
      400,
      { codigo: 'VENTANA', fechaMaxima: maxima, ventanaDias }
    );
  }
}

/** No se reserva en el pasado (se compara la primera ocurrencia con el instante actual). */
export function validarNoPasado(ocs: Ocurrencia[], ahoraMs: number): void {
  if (ocs.length > 0 && ocs[0].inicioMs < ahoraMs) {
    throw new ErrorReserva('No se puede reservar en una fecha u hora que ya pasó.');
  }
}

/** Cruces entre las ocurrencias pedidas y los eventos que ya tiene la sala. */
export function detectarChoques(ocs: Ocurrencia[], existentes: EventoExistente[]): Choque[] {
  const choques: Choque[] = [];
  for (const o of ocs) {
    for (const e of existentes) {
      if (o.inicioMs < e.finMs && e.inicioMs < o.finMs) {
        choques.push({ fecha: o.fecha, asunto: e.asunto, horaInicio: e.horaInicio, horaFin: e.horaFin });
      }
    }
  }
  return choques;
}

/** Bloqueo de SALAS_SOLO_LECTURA: lanza 423 antes de cualquier escritura en Graph. */
export function exigirEscritura(soloLectura: boolean, mensaje: string): void {
  if (soloLectura) throw new ErrorReserva(mensaje, 423, { codigo: 'SOLO_LECTURA' });
}

const DIAS_GRAPH = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/**
 * Patrón de recurrencia de Graph para los tipos regulares. Los «días
 * específicos» no tienen patrón: se crean como eventos sueltos.
 */
export function patronGraph(inicio: string, rep: Repeticion): Record<string, unknown> | null {
  const [, mes, dia] = inicio.split('-').map(Number);
  switch (rep.tipo) {
    case 'diaria':
      return rep.soloHabiles
        ? { type: 'weekly', interval: 1, daysOfWeek: DIAS_GRAPH.slice(1, 6), firstDayOfWeek: 'sunday' }
        : { type: 'daily', interval: 1 };
    case 'semanal': {
      const dias = rep.diasSemana?.length ? rep.diasSemana : [diaSemana(inicio)];
      return {
        type: 'weekly',
        interval: 1,
        daysOfWeek: [...new Set(dias)].sort().map((d) => DIAS_GRAPH[d]),
        firstDayOfWeek: 'sunday',
      };
    }
    case 'mensual':
      return { type: 'absoluteMonthly', interval: 1, dayOfMonth: dia };
    case 'anual':
      return { type: 'absoluteYearly', interval: 1, dayOfMonth: dia, month: mes };
    default:
      return null;
  }
}
