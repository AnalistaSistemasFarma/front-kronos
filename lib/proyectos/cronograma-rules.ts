/**
 * Cronograma de un proyecto (2026-10-18, pedido de Nicolás Rivera) — reglas PURAS
 * (sin base de datos): validación de tareas, fechas que se usan para cada
 * solicitud, geometría del Gantt y eventos del calendario. Lo usan el servidor
 * (lib/proyectos/cronograma.ts), la interfaz (components/proyectos/cronograma/**)
 * y kronos-mcp replica la misma tabla de fechas.
 *
 * FECHAS: siempre de CALENDARIO (YYYY-MM-DD, sin hora), en la zona de Bogotá.
 *
 * -------------------------------------------------------------------------
 * QUÉ FECHAS USA UNA SOLICITUD EN EL CRONOGRAMA (decisión documentada)
 * -------------------------------------------------------------------------
 * SynerLink no guarda una «fecha de vencimiento» por solicitud. Por eso:
 *   - INICIO      = requests_general.created_at (día en que se radicó).
 *   - FIN
 *       · resuelta o cancelada (status_req 2 / 3): date_resolution (si falta,
 *         el día de inicio);
 *       · abierta: HOY, o la FECHA OBJETIVO si es posterior. La barra crece
 *         día a día mientras el caso siga abierto.
 *   - FECHA OBJETIVO (chat_project_request.target_date): la fija el dueño o un
 *     editor DENTRO del proyecto; es el «vencimiento» que se ve en el
 *     calendario. Si pasó y el caso sigue abierto, la solicitud sale VENCIDA.
 *   - ESTADO VIVO: status_case del caso, leído en cada carga.
 *   - ACTIVIDADES del workflow (task_request_general) como sub-ítems:
 *       inicio = start_date (si falta, el de la solicitud);
 *       fin    = date_resolution, o end_date, o HOY si sigue abierta.
 *     Ojo: el motor estampa start/end al cerrar la actividad, así que la
 *     duración de una actividad cerrada suele ser de un día; el tiempo de
 *     ciclo confiable es el de la solicitud.
 */

export const TASK_STATUSES = ['pendiente', 'en_curso', 'hecha', 'bloqueada'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  pendiente: 'Pendiente',
  en_curso: 'En curso',
  hecha: 'Hecha',
  bloqueada: 'Bloqueada',
};

/** Estado VISUAL de cualquier barra (tarea, solicitud o actividad). */
export type EstadoVisual = TaskStatus | 'abierta' | 'vencida' | 'cancelada';

export const ESTADO_VISUAL_LABELS: Record<EstadoVisual, string> = {
  ...TASK_STATUS_LABELS,
  abierta: 'Abierta',
  vencida: 'Vencida',
  cancelada: 'Cancelada',
};

/** Color de Mantine por estado (claro y oscuro salen del tema). */
export const ESTADO_VISUAL_COLOR: Record<EstadoVisual, string> = {
  pendiente: 'gray',
  en_curso: 'blue',
  hecha: 'green',
  bloqueada: 'orange',
  abierta: 'cyan',
  vencida: 'red',
  cancelada: 'dark',
};

export function isTaskStatus(v: unknown): v is TaskStatus {
  return typeof v === 'string' && (TASK_STATUSES as readonly string[]).includes(v);
}

/* ───────────────────────────── Límites ───────────────────────────── */

export const MAX_TASK_TITLE_CHARS = 200;
export const MAX_TASK_DESCRIPTION_CHARS = 2_000;
/** Tareas por proyecto (van completas al contexto del agente). */
export const MAX_PROJECT_TASKS = 300;
/** Una tarea no dura más de tres años (evita barras absurdas por un error de digitación). */
export const MAX_TASK_SPAN_DAYS = 3 * 366;
const FECHA_MIN = '2000-01-01';
const FECHA_MAX = '2100-12-31';

/* ───────────────────────────── Fechas ───────────────────────────── */

const DIA_MS = 86_400_000;

/** ¿Es una fecha de calendario válida (YYYY-MM-DD) en un rango sensato? */
export function esFechaIso(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number);
  const f = new Date(Date.UTC(y, m - 1, d));
  if (f.getUTCFullYear() !== y || f.getUTCMonth() !== m - 1 || f.getUTCDate() !== d) return false;
  return v >= FECHA_MIN && v <= FECHA_MAX;
}

function aUtc(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function isoDeUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Días de `a` a `b` (b − a). */
export function diasEntre(a: string, b: string): number {
  return Math.round((aUtc(b) - aUtc(a)) / DIA_MS);
}

export function sumarDias(iso: string, n: number): string {
  return isoDeUtc(aUtc(iso) + n * DIA_MS);
}

/** Hoy en Bogotá (YYYY-MM-DD). */
export function hoyBogota(ahora: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).format(ahora);
}

/** Lunes de la semana de la fecha. */
export function lunesDe(iso: string): string {
  const dow = (new Date(aUtc(iso)).getUTCDay() + 6) % 7;
  return sumarDias(iso, -dow);
}

function inicioDeMes(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

function finDeMes(iso: string): string {
  const [y, m] = iso.split('-').map(Number);
  return isoDeUtc(Date.UTC(y, m, 0));
}

function inicioDeTrimestre(iso: string): string {
  const [y, m] = iso.split('-').map(Number);
  const q = Math.floor((m - 1) / 3) * 3 + 1;
  return `${y}-${String(q).padStart(2, '0')}-01`;
}

function finDeTrimestre(iso: string): string {
  const [y, m] = iso.split('-').map(Number);
  const q = Math.floor((m - 1) / 3) * 3 + 3;
  return isoDeUtc(Date.UTC(y, q, 0));
}

/**
 * Fecha de un valor de la base (Date o texto). Las columnas DATE llegan a
 * medianoche UTC; las DATETIME de SynerLink guardan la hora LOCAL de Colombia
 * (lib/dbDate.ts), así que en ambos casos el día es el de la parte UTC.
 */
export function fechaDeDb(v: Date | string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/* ───────────────────────────── Tareas ───────────────────────────── */

export interface TareaValores {
  title: string;
  description: string | null;
  idResponsible: string | null;
  startDate: string;
  endDate: string;
  status: TaskStatus;
  progress: number | null;
  isMilestone: boolean;
}

export type Validacion<T> = { ok: true; value: T } | { ok: false; error: string };

const CAMPOS_TAREA = ['title', 'description', 'idResponsible', 'startDate', 'endDate', 'status', 'progress', 'isMilestone'] as const;

/**
 * Valida una tarea nueva (`base` = null) o un cambio sobre una existente
 * (`base` = sus valores actuales; solo cambian los campos que vengan). Devuelve
 * la tarea COMPLETA ya combinada. Que el responsable sea miembro lo valida la
 * capa de datos.
 */
export function normalizarTarea(raw: unknown, base: TareaValores | null): Validacion<TareaValores> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, error: 'Datos de la tarea inválidos.' };
  const r = raw as Record<string, unknown>;
  if (base && !CAMPOS_TAREA.some((c) => r[c] !== undefined)) return { ok: false, error: 'No hay nada que cambiar.' };

  const v: TareaValores = base
    ? { ...base }
    : { title: '', description: null, idResponsible: null, startDate: '', endDate: '', status: 'pendiente', progress: null, isMilestone: false };

  if (r.title !== undefined || !base) {
    if (typeof r.title !== 'string') return { ok: false, error: 'El título de la tarea es obligatorio.' };
    const t = r.title.replace(/\s+/g, ' ').trim();
    if (!t) return { ok: false, error: 'El título de la tarea es obligatorio.' };
    if (t.length > MAX_TASK_TITLE_CHARS) return { ok: false, error: `El título no puede pasar de ${MAX_TASK_TITLE_CHARS} caracteres.` };
    v.title = t;
  }
  if (r.description !== undefined) {
    if (r.description === null) v.description = null;
    else if (typeof r.description !== 'string') return { ok: false, error: 'La descripción debe ser texto.' };
    else {
      const d = r.description.replace(/\r\n/g, '\n').trim();
      if (d.length > MAX_TASK_DESCRIPTION_CHARS) return { ok: false, error: `La descripción no puede pasar de ${MAX_TASK_DESCRIPTION_CHARS} caracteres.` };
      v.description = d || null;
    }
  }
  if (r.idResponsible !== undefined) {
    if (r.idResponsible === null || r.idResponsible === '') v.idResponsible = null;
    else if (typeof r.idResponsible !== 'string' || r.idResponsible.length > 1000) return { ok: false, error: 'Responsable inválido.' };
    else v.idResponsible = r.idResponsible.trim();
  }
  if (r.startDate !== undefined || !base) {
    if (!esFechaIso(r.startDate)) return { ok: false, error: 'La fecha de inicio es obligatoria (AAAA-MM-DD).' };
    v.startDate = r.startDate;
  }
  if (r.endDate !== undefined && r.endDate !== null && r.endDate !== '') {
    if (!esFechaIso(r.endDate)) return { ok: false, error: 'La fecha de fin no es válida (AAAA-MM-DD).' };
    v.endDate = r.endDate;
  } else if (!base) {
    v.endDate = v.startDate;
  }
  if (r.status !== undefined) {
    if (!isTaskStatus(r.status)) return { ok: false, error: 'El estado debe ser pendiente, en curso, hecha o bloqueada.' };
    v.status = r.status;
  }
  if (r.progress !== undefined) {
    if (r.progress === null || r.progress === '') v.progress = null;
    else if (typeof r.progress !== 'number' || !Number.isInteger(r.progress) || r.progress < 0 || r.progress > 100) {
      return { ok: false, error: 'El avance debe ser un número entero entre 0 y 100.' };
    } else v.progress = r.progress;
  }
  if (r.isMilestone !== undefined) {
    if (typeof r.isMilestone !== 'boolean') return { ok: false, error: 'Hito debe ser sí o no.' };
    v.isMilestone = r.isMilestone;
  }

  // Un hito es un día: el fin es el inicio.
  if (v.isMilestone) v.endDate = v.startDate;
  if (v.endDate < v.startDate) return { ok: false, error: 'La fecha de fin no puede ser anterior a la de inicio.' };
  if (diasEntre(v.startDate, v.endDate) > MAX_TASK_SPAN_DAYS) return { ok: false, error: 'Una tarea no puede durar más de tres años.' };
  return { ok: true, value: v };
}

/** Campos que cambiaron: { campo: [antes, después] } (para la auditoría). */
export function cambiosDeTarea(antes: TareaValores, despues: TareaValores): Record<string, [unknown, unknown]> {
  const out: Record<string, [unknown, unknown]> = {};
  for (const c of CAMPOS_TAREA) if (antes[c] !== despues[c]) out[c] = [antes[c], despues[c]];
  return out;
}

const ETIQUETA_CAMPO: Record<(typeof CAMPOS_TAREA)[number], string> = {
  title: 'título',
  description: 'descripción',
  idResponsible: 'responsable',
  startDate: 'inicio',
  endDate: 'fin',
  status: 'estado',
  progress: 'avance',
  isMilestone: 'hito',
};

/** «estado: Pendiente → En curso; avance: — → 40 %» (texto de la auditoría). */
export function describirCambios(cambios: Record<string, [unknown, unknown]>, nombres: (id: string | null) => string = (x) => x ?? '—'): string {
  const fmt = (campo: string, x: unknown) => {
    if (x === null || x === undefined || x === '') return '—';
    if (campo === 'status' && isTaskStatus(x)) return TASK_STATUS_LABELS[x];
    if (campo === 'progress') return `${x} %`;
    if (campo === 'isMilestone') return x ? 'sí' : 'no';
    if (campo === 'idResponsible') return nombres(String(x));
    if (campo === 'description') return '(texto)';
    return String(x);
  };
  return Object.entries(cambios)
    .map(([c, [a, b]]) => `${ETIQUETA_CAMPO[c as keyof typeof ETIQUETA_CAMPO] ?? c}: ${fmt(c, a)} → ${fmt(c, b)}`)
    .join('; ');
}

/** Estado visual de una tarea: una pendiente o en curso cuyo fin ya pasó sale VENCIDA. */
export function estadoVisualTarea(t: Pick<TareaValores, 'status' | 'endDate'>, hoy: string): EstadoVisual {
  if ((t.status === 'pendiente' || t.status === 'en_curso') && t.endDate < hoy) return 'vencida';
  return t.status;
}

/* ───────────────────────────── Solicitudes ───────────────────────────── */

/** status_req / id_status de SynerLink: 2 = resuelta, 3 = cancelada; lo demás, abierta. */
export function solicitudCerrada(idStatus: number | null | undefined): boolean {
  return idStatus === 2 || idStatus === 3;
}

export interface FechasSolicitud {
  inicio: string;
  fin: string;
  abierta: boolean;
  vencida: boolean;
  estadoVisual: EstadoVisual;
}

/** Ver «QUÉ FECHAS USA UNA SOLICITUD» en el encabezado. */
export function fechasDeSolicitud(
  e: { createdAt: string | null; resolvedAt: string | null; idStatus: number | null; targetDate: string | null },
  hoy: string
): FechasSolicitud {
  const inicio = e.createdAt ?? e.targetDate ?? hoy;
  if (solicitudCerrada(e.idStatus)) {
    const fin = e.resolvedAt && e.resolvedAt >= inicio ? e.resolvedAt : inicio;
    return { inicio, fin, abierta: false, vencida: false, estadoVisual: e.idStatus === 3 ? 'cancelada' : 'hecha' };
  }
  const fin = e.targetDate && e.targetDate > hoy ? e.targetDate : hoy;
  const vencida = Boolean(e.targetDate && e.targetDate < hoy);
  return { inicio, fin: fin < inicio ? inicio : fin, abierta: true, vencida, estadoVisual: vencida ? 'vencida' : 'abierta' };
}

/** Fechas de una actividad del workflow (sub-ítem). */
export function fechasDeActividad(
  a: { startDate: string | null; endDate: string | null; resolvedAt: string | null; idStatus: number | null },
  inicioSolicitud: string,
  hoy: string
): FechasSolicitud {
  const inicio = a.startDate ?? inicioSolicitud;
  const cerrada = solicitudCerrada(a.idStatus);
  let fin = a.resolvedAt ?? a.endDate ?? (cerrada ? inicio : hoy);
  if (fin < inicio) fin = inicio;
  return { inicio, fin, abierta: !cerrada, vencida: false, estadoVisual: cerrada ? (a.idStatus === 3 ? 'cancelada' : 'hecha') : 'en_curso' };
}

/* ───────────────────────────── Gantt ───────────────────────────── */

export type ZoomGantt = 'semana' | 'mes' | 'trimestre';
export const ZOOMS: ZoomGantt[] = ['semana', 'mes', 'trimestre'];
export const ZOOM_LABELS: Record<ZoomGantt, string> = { semana: 'Semana', mes: 'Mes', trimestre: 'Trimestre' };

/** Píxeles por día en cada zoom. */
export const PX_POR_DIA: Record<ZoomGantt, number> = { semana: 34, mes: 12, trimestre: 4 };

/** Días mínimos visibles por zoom (para que un proyecto corto no se vea apretado). */
const DIAS_MINIMOS: Record<ZoomGantt, number> = { semana: 28, mes: 92, trimestre: 273 };
/** Tope de la línea de tiempo: tres años. */
export const MAX_DIAS_GANTT = 3 * 366;

/** Rango visible: cubre todos los ítems y hoy, redondeado al zoom. */
export function rangoGantt(items: { inicio: string; fin: string }[], hoy: string, zoom: ZoomGantt): { desde: string; hasta: string; dias: number } {
  let min = hoy;
  let max = hoy;
  for (const i of items) {
    if (i.inicio < min) min = i.inicio;
    if (i.fin > max) max = i.fin;
  }
  let desde = zoom === 'semana' ? lunesDe(sumarDias(min, -3)) : zoom === 'mes' ? inicioDeMes(min) : inicioDeTrimestre(min);
  let hasta = zoom === 'semana' ? sumarDias(lunesDe(sumarDias(max, 3)), 6) : zoom === 'mes' ? finDeMes(max) : finDeTrimestre(max);
  if (diasEntre(desde, hasta) + 1 < DIAS_MINIMOS[zoom]) {
    const fin = sumarDias(desde, DIAS_MINIMOS[zoom] - 1);
    hasta = zoom === 'semana' ? sumarDias(lunesDe(fin), 6) : zoom === 'mes' ? finDeMes(fin) : finDeTrimestre(fin);
  }
  if (diasEntre(desde, hasta) + 1 > MAX_DIAS_GANTT) {
    // Demasiado largo: se centra en hoy.
    desde = zoom === 'semana' ? lunesDe(sumarDias(hoy, -365)) : inicioDeMes(sumarDias(hoy, -365));
    hasta = sumarDias(desde, MAX_DIAS_GANTT - 1);
  }
  return { desde, hasta, dias: diasEntre(desde, hasta) + 1 };
}

/** Posición de una barra: izquierda y ancho en píxeles (el fin cuenta como día completo). */
export function posicionBarra(inicio: string, fin: string, desde: string, pxDia: number): { left: number; width: number } {
  const left = Math.max(0, diasEntre(desde, inicio)) * pxDia;
  const dias = Math.max(1, diasEntre(inicio < desde ? desde : inicio, fin) + 1);
  return { left, width: Math.max(pxDia, dias * pxDia) };
}

const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIAS_INICIAL = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

export interface MarcaGantt {
  fecha: string;
  left: number;
  width: number;
  etiqueta: string;
}

/** Dos filas de encabezado: la MAYOR (mes o trimestre) y la MENOR (día, semana o mes). */
export function marcasGantt(desde: string, hasta: string, zoom: ZoomGantt): { mayores: MarcaGantt[]; menores: MarcaGantt[] } {
  const px = PX_POR_DIA[zoom];
  const mayores: MarcaGantt[] = [];
  const menores: MarcaGantt[] = [];
  const total = diasEntre(desde, hasta) + 1;
  const pos = (f: string) => diasEntre(desde, f) * px;

  // Mayores: meses (semana y mes) o trimestres.
  let f = zoom === 'trimestre' ? inicioDeTrimestre(desde) : inicioDeMes(desde);
  while (f <= hasta) {
    const fin = zoom === 'trimestre' ? finDeTrimestre(f) : finDeMes(f);
    const a = Math.max(0, pos(f));
    const b = Math.min(total * px, (diasEntre(desde, fin) + 1) * px);
    const [y, m] = f.split('-').map(Number);
    mayores.push({
      fecha: f,
      left: a,
      width: b - a,
      etiqueta: zoom === 'trimestre' ? `T${Math.floor((m - 1) / 3) + 1} ${y}` : `${MESES[m - 1]} ${y}`,
    });
    f = sumarDias(fin, 1);
  }

  // Menores.
  if (zoom === 'semana') {
    for (let i = 0; i < total; i++) {
      const d = sumarDias(desde, i);
      const dow = (new Date(aUtc(d)).getUTCDay() + 6) % 7;
      menores.push({ fecha: d, left: i * px, width: px, etiqueta: `${DIAS_INICIAL[dow]} ${Number(d.slice(8))}` });
    }
  } else if (zoom === 'mes') {
    for (let d = lunesDe(desde); d <= hasta; d = sumarDias(d, 7)) {
      const a = Math.max(0, pos(d));
      const b = Math.min(total * px, pos(sumarDias(d, 7)));
      if (b <= a) continue;
      const [, m, dd] = d.split('-').map(Number);
      menores.push({ fecha: d, left: a, width: b - a, etiqueta: `${dd} ${MESES_CORTOS[m - 1]}` });
    }
  } else {
    for (let d = inicioDeMes(desde); d <= hasta; d = sumarDias(finDeMes(d), 1)) {
      const a = Math.max(0, pos(d));
      const b = Math.min(total * px, (diasEntre(desde, finDeMes(d)) + 1) * px);
      menores.push({ fecha: d, left: a, width: b - a, etiqueta: MESES_CORTOS[Number(d.slice(5, 7)) - 1] });
    }
  }
  return { mayores, menores };
}

/** «13 oct.» o «13 oct. 2025» si no es del año de referencia. */
export function fechaCortaIso(iso: string | null | undefined, anioRef?: number): string {
  if (!iso || !esFechaIso(iso)) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MESES_CORTOS[m - 1]}.${anioRef !== undefined && y !== anioRef ? ` ${y}` : ''}`;
}

/** «13 de mayo de 2026» (prosa formal colombiana). */
export function fechaLargaIso(iso: string | null | undefined): string {
  if (!iso || !esFechaIso(iso)) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} de ${MESES[m - 1]} de ${y}`;
}

/* ───────────────────────────── Calendario ───────────────────────────── */

export type TipoEvento = 'inicio' | 'fin' | 'hito' | 'creada' | 'objetivo' | 'resuelta';

export const TIPO_EVENTO_LABELS: Record<TipoEvento, string> = {
  inicio: 'Inicia',
  fin: 'Vence',
  hito: 'Hito',
  creada: 'Solicitud radicada',
  objetivo: 'Fecha objetivo',
  resuelta: 'Solicitud cerrada',
};

export interface EventoCalendario {
  key: string;
  fecha: string;
  tipo: TipoEvento;
  titulo: string;
  estado: EstadoVisual;
  ref: { kind: 'tarea' | 'solicitud'; id: number };
}

export interface TareaParaEventos {
  id: number;
  title: string;
  startDate: string;
  endDate: string;
  status: TaskStatus;
  isMilestone: boolean;
}

export interface SolicitudParaEventos {
  idRequest: number;
  subject: string;
  createdAt: string | null;
  resolvedAt: string | null;
  idStatus: number | null;
  targetDate: string | null;
}

/**
 * Eventos del calendario: inicio y vencimiento de cada tarea (un hito o una
 * tarea de un día, un solo evento), y de cada solicitud su radicación, su
 * fecha objetivo y su cierre. Ordenados por fecha.
 */
export function eventosCalendario(tareas: TareaParaEventos[], solicitudes: SolicitudParaEventos[], hoy: string): EventoCalendario[] {
  const out: EventoCalendario[] = [];
  for (const t of tareas) {
    const estado = estadoVisualTarea(t, hoy);
    const ref = { kind: 'tarea' as const, id: t.id };
    if (t.isMilestone) out.push({ key: `t${t.id}-h`, fecha: t.startDate, tipo: 'hito', titulo: t.title, estado, ref });
    else if (t.startDate === t.endDate) out.push({ key: `t${t.id}-f`, fecha: t.endDate, tipo: 'fin', titulo: t.title, estado, ref });
    else {
      out.push({ key: `t${t.id}-i`, fecha: t.startDate, tipo: 'inicio', titulo: t.title, estado, ref });
      out.push({ key: `t${t.id}-f`, fecha: t.endDate, tipo: 'fin', titulo: t.title, estado, ref });
    }
  }
  for (const s of solicitudes) {
    const f = fechasDeSolicitud(s, hoy);
    const ref = { kind: 'solicitud' as const, id: s.idRequest };
    const titulo = `#${s.idRequest} ${s.subject}`;
    if (s.createdAt) out.push({ key: `s${s.idRequest}-c`, fecha: s.createdAt, tipo: 'creada', titulo, estado: f.estadoVisual, ref });
    if (s.targetDate) out.push({ key: `s${s.idRequest}-o`, fecha: s.targetDate, tipo: 'objetivo', titulo, estado: f.estadoVisual, ref });
    if (!f.abierta && s.resolvedAt) out.push({ key: `s${s.idRequest}-r`, fecha: s.resolvedAt, tipo: 'resuelta', titulo, estado: f.estadoVisual, ref });
  }
  return out.sort((a, b) => (a.fecha === b.fecha ? a.titulo.localeCompare(b.titulo, 'es') : a.fecha < b.fecha ? -1 : 1));
}

/** Eventos de un rango [desde, hasta], agrupados por día (agenda). */
export function agruparPorDia(eventos: EventoCalendario[], desde?: string, hasta?: string): { fecha: string; eventos: EventoCalendario[] }[] {
  const mapa = new Map<string, EventoCalendario[]>();
  for (const e of eventos) {
    if (desde && e.fecha < desde) continue;
    if (hasta && e.fecha > hasta) continue;
    const l = mapa.get(e.fecha) ?? [];
    l.push(e);
    mapa.set(e.fecha, l);
  }
  return [...mapa.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([fecha, ev]) => ({ fecha, eventos: ev }));
}
