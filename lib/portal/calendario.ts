/**
 * PORTAL DE TALENTO HUMANO — CALENDARIO de la ventana principal (Cristian Baldión, 2026-10-09):
 * calendario de Colombia con festivos y fechas importantes, y los eventos de cada día.
 *
 * Archivo PURO (sin red ni base). Los FESTIVOS se CALCULAN por ley, para cualquier año: no dependen de un
 * servicio externo que pueda caerse ni de una lista que haya que actualizar cada enero.
 *
 *   - Ley 51 de 1983 (Ley Emiliani): los festivos que caen en otro día pasan al LUNES siguiente.
 *   - Fijos: 1 ene, 1 may, 20 jul, 7 ago, 8 dic, 25 dic.
 *   - Emiliani: 6 ene, 19 mar, 29 jun, 15 ago, 12 oct, 1 nov, 11 nov.
 *   - Semana Santa (Jueves y Viernes Santo, sin traslado) y los que dependen de la Pascua y pasan al
 *     lunes: Ascensión (+39 días), Corpus Christi (+60) y Sagrado Corazón (+68).
 *
 * Las FECHAS IMPORTANTES son fijas por año: obligaciones laborales (intereses de cesantías, cesantías, prima
 * de servicios) y conmemoraciones. Los EVENTOS DE LA EMPRESA vienen de la base (`portal_evento`).
 *
 * Todas las fechas viajan como texto `AAAA-MM-DD` (sin hora ni zona) para que "el 12 de octubre" sea el 12 de
 * octubre en cualquier computador; los cálculos usan UTC solo como contenedor de calendario.
 */

export type TipoEvento = 'festivo' | 'laboral' | 'conmemoracion' | 'empresa';

export interface EventoDia {
  /** Solo los de la empresa tienen id (se pueden borrar). */
  id?: number;
  fecha: string;
  titulo: string;
  tipo: TipoEvento;
  descripcion?: string | null;
}

export const NOMBRE_TIPO: Record<TipoEvento, string> = {
  festivo: 'Festivo',
  laboral: 'Fecha laboral',
  conmemoracion: 'Fecha importante',
  empresa: 'Evento de la empresa',
};

export const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const DIAS_SEMANA_CORTO = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
export const DIAS_SEMANA = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

const DOS = (n: number) => String(n).padStart(2, '0');
export const aIso = (f: Date): string => `${f.getUTCFullYear()}-${DOS(f.getUTCMonth() + 1)}-${DOS(f.getUTCDate())}`;
const utc = (a: number, m: number, d: number) => new Date(Date.UTC(a, m - 1, d));
const sumarDias = (f: Date, n: number) => new Date(f.getTime() + n * 86_400_000);

/** `AAAA-MM-DD` real (no acepta 2026-02-30) entre 2000 y 2100. */
export function fechaValida(texto: unknown): texto is string {
  if (typeof texto !== 'string') return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);
  if (!m) return false;
  const [a, me, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (a < 2000 || a > 2100) return false;
  const f = utc(a, me, d);
  return f.getUTCFullYear() === a && f.getUTCMonth() === me - 1 && f.getUTCDate() === d;
}

export const desdeIso = (iso: string): Date => {
  const [a, m, d] = iso.split('-').map(Number);
  return utc(a, m, d);
};

/** Hoy, en hora de Colombia (no la del computador de la persona). */
export function hoyEnBogota(ahora: Date = new Date()): string {
  const partes = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).format(ahora);
  return partes; // en-CA ya da AAAA-MM-DD
}

/** Domingo de Pascua (algoritmo gregoriano anónimo de Meeus/Jones/Butcher). */
export function pascua(año: number): Date {
  const a = año % 19;
  const b = Math.floor(año / 100);
  const c = año % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return utc(año, mes, dia);
}

/** Ley Emiliani: si no cae en lunes, pasa al lunes siguiente. */
export function siguienteLunes(f: Date): Date {
  const dow = f.getUTCDay(); // 0 domingo … 6 sábado
  return sumarDias(f, (8 - dow) % 7);
}

/** El `n`-ésimo `diaSemana` (0 domingo … 6 sábado) del mes (`mes` 1-12). */
export function enesimoDiaSemana(año: number, mes: number, diaSemana: number, n: number): Date {
  const primero = utc(año, mes, 1);
  const desplazamiento = (diaSemana - primero.getUTCDay() + 7) % 7;
  return utc(año, mes, 1 + desplazamiento + (n - 1) * 7);
}

/** Los 18 festivos de Colombia de un año, por fecha. */
export function festivosColombia(año: number): EventoDia[] {
  const p = pascua(año);
  const lista: [Date, string][] = [
    [utc(año, 1, 1), 'Año Nuevo'],
    [siguienteLunes(utc(año, 1, 6)), 'Día de los Reyes Magos'],
    [siguienteLunes(utc(año, 3, 19)), 'Día de San José'],
    [sumarDias(p, -3), 'Jueves Santo'],
    [sumarDias(p, -2), 'Viernes Santo'],
    [utc(año, 5, 1), 'Día del Trabajo'],
    [siguienteLunes(sumarDias(p, 39)), 'Ascensión del Señor'],
    [siguienteLunes(sumarDias(p, 60)), 'Corpus Christi'],
    [siguienteLunes(sumarDias(p, 68)), 'Sagrado Corazón de Jesús'],
    [siguienteLunes(utc(año, 6, 29)), 'San Pedro y San Pablo'],
    [utc(año, 7, 20), 'Día de la Independencia'],
    [utc(año, 8, 7), 'Batalla de Boyacá'],
    [siguienteLunes(utc(año, 8, 15)), 'Asunción de la Virgen'],
    [siguienteLunes(utc(año, 10, 12)), 'Día de la Diversidad Étnica y Cultural'],
    [siguienteLunes(utc(año, 11, 1)), 'Día de Todos los Santos'],
    [siguienteLunes(utc(año, 11, 11)), 'Independencia de Cartagena'],
    [utc(año, 12, 8), 'Día de la Inmaculada Concepción'],
    [utc(año, 12, 25), 'Navidad'],
  ];
  return lista.map(([f, titulo]) => ({ fecha: aIso(f), titulo, tipo: 'festivo' as const })).sort((x, y) => x.fecha.localeCompare(y.fecha));
}

/**
 * Fechas importantes de cada año: obligaciones laborales y conmemoraciones. Las laborales son los LÍMITES
 * legales de pago (si el día cae en fin de semana o festivo, en la práctica se paga antes): conviene que
 * Talento Humano o Jurídica las valide una vez.
 */
export function fechasImportantes(año: number): EventoDia[] {
  const lista: [Date, string, TipoEvento][] = [
    [utc(año, 1, 31), 'Límite para pagar los intereses sobre las cesantías', 'laboral'],
    [utc(año, 2, 14), 'Límite para consignar las cesantías en el fondo', 'laboral'],
    [utc(año, 3, 8), 'Día Internacional de la Mujer', 'conmemoracion'],
    [utc(año, 4, 28), 'Día Mundial de la Seguridad y Salud en el Trabajo', 'conmemoracion'],
    [enesimoDiaSemana(año, 5, 0, 2), 'Día de la Madre', 'conmemoracion'],
    [utc(año, 6, 5), 'Día Mundial del Medio Ambiente', 'conmemoracion'],
    [enesimoDiaSemana(año, 6, 0, 3), 'Día del Padre', 'conmemoracion'],
    [utc(año, 6, 30), 'Límite para pagar la prima de servicios (primer semestre)', 'laboral'],
    [enesimoDiaSemana(año, 9, 6, 3), 'Día del Amor y la Amistad', 'conmemoracion'],
    [utc(año, 12, 16), 'Inicio de la Novena de Aguinaldos', 'conmemoracion'],
    [utc(año, 12, 20), 'Límite para pagar la prima de servicios (segundo semestre)', 'laboral'],
    [utc(año, 12, 24), 'Nochebuena', 'conmemoracion'],
    [utc(año, 12, 31), 'Fin de año', 'conmemoracion'],
  ];
  return lista.map(([f, titulo, tipo]) => ({ fecha: aIso(f), titulo, tipo })).sort((x, y) => x.fecha.localeCompare(y.fecha));
}

/** Festivos y fechas importantes de los años que toca la cuadrícula visible, indexados por día. */
export function eventosFijosPorDia(años: number[]): Map<string, EventoDia[]> {
  const mapa = new Map<string, EventoDia[]>();
  for (const a of new Set(años)) {
    for (const e of [...festivosColombia(a), ...fechasImportantes(a)]) {
      const dia = mapa.get(e.fecha) ?? [];
      dia.push(e);
      mapa.set(e.fecha, dia);
    }
  }
  return mapa;
}

export interface CeldaDia {
  fecha: string;
  dia: number;
  delMes: boolean;
}

/** Cuadrícula del mes (`mes` 1-12), de lunes a domingo, siempre de 6 semanas (42 celdas). */
export function cuadriculaDelMes(año: number, mes: number): CeldaDia[] {
  const primero = utc(año, mes, 1);
  const desplazamiento = (primero.getUTCDay() + 6) % 7; // lunes = 0
  const inicio = sumarDias(primero, -desplazamiento);
  return Array.from({ length: 42 }, (_, i) => {
    const f = sumarDias(inicio, i);
    return { fecha: aIso(f), dia: f.getUTCDate(), delMes: f.getUTCMonth() === mes - 1 };
  });
}

/** Mes anterior o siguiente. */
export function mesVecino(año: number, mes: number, delta: -1 | 1): { año: number; mes: number } {
  const n = mes - 1 + delta;
  return { año: año + Math.floor(n / 12), mes: ((n % 12) + 12) % 12 + 1 };
}

/** "viernes, 9 de octubre de 2026" */
export function fechaLarga(iso: string): string {
  const f = desdeIso(iso);
  const dia = DIAS_SEMANA[(f.getUTCDay() + 6) % 7];
  return `${dia}, ${f.getUTCDate()} de ${MESES[f.getUTCMonth()]} de ${f.getUTCFullYear()}`;
}

/** Orden dentro de un día: festivos, laborales, conmemoraciones y, al final, los de la empresa. */
const ORDEN: Record<TipoEvento, number> = { festivo: 0, laboral: 1, conmemoracion: 2, empresa: 3 };
export const ordenarEventos = (lista: EventoDia[]): EventoDia[] => [...lista].sort((a, b) => ORDEN[a.tipo] - ORDEN[b.tipo] || a.titulo.localeCompare(b.titulo, 'es'));

/** Une los fijos con los de la empresa: `fecha → eventos ordenados`. */
export function unirEventos(fijos: Map<string, EventoDia[]>, empresa: EventoDia[]): Map<string, EventoDia[]> {
  const todo = new Map<string, EventoDia[]>();
  for (const [f, l] of fijos) todo.set(f, [...l]);
  for (const e of empresa) todo.set(e.fecha, [...(todo.get(e.fecha) ?? []), e]);
  for (const [f, l] of todo) todo.set(f, ordenarEventos(l));
  return todo;
}

/** Los próximos eventos a partir de un día (sin contarlo), de lo ya cargado. */
export function proximos(todo: Map<string, EventoDia[]>, desde: string, max = 3): EventoDia[] {
  return [...todo.keys()]
    .filter((f) => f > desde)
    .sort()
    .flatMap((f) => todo.get(f) ?? [])
    .slice(0, max);
}

// ── Validación de eventos de la empresa (la usan la ruta y el formulario) ─────────────────────────────

export const MAX_TITULO_EVENTO = 160;
export const MAX_DESCRIPCION_EVENTO = 1000;
export const MAX_EVENTOS_POR_DIA = 30;

/** Sin caracteres de control y con espacios colapsados (la descripción conserva los saltos de línea). */
const limpiarLinea = (v: unknown, max: number): string =>
  typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
const limpiarTexto = (v: unknown, max: number): string =>
  typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, '').replace(/[ \t]+/g, ' ').trim().slice(0, max) : '';

export function validarEvento(crudo: unknown): { ok: true; fecha: string; titulo: string; descripcion: string | null } | { ok: false; error: string } {
  const d = (crudo && typeof crudo === 'object' ? crudo : {}) as Record<string, unknown>;
  if (!fechaValida(d.fecha)) return { ok: false, error: 'Elija una fecha válida.' };
  const titulo = limpiarLinea(d.titulo, MAX_TITULO_EVENTO);
  if (!titulo) return { ok: false, error: 'Escriba el título del evento.' };
  if (typeof d.titulo === 'string' && d.titulo.trim().length > MAX_TITULO_EVENTO) return { ok: false, error: `El título admite máximo ${MAX_TITULO_EVENTO} caracteres.` };
  const descripcion = limpiarTexto(d.descripcion, MAX_DESCRIPCION_EVENTO);
  if (typeof d.descripcion === 'string' && d.descripcion.trim().length > MAX_DESCRIPCION_EVENTO) {
    return { ok: false, error: `La descripción admite máximo ${MAX_DESCRIPCION_EVENTO} caracteres.` };
  }
  return { ok: true, fecha: d.fecha, titulo, descripcion: descripcion || null };
}
