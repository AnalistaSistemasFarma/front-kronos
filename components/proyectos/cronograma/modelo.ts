/**
 * Del cronograma (API) a las filas del Gantt y a los eventos del calendario. Puro: sin React.
 * Las fechas de cada solicitud y actividad salen de lib/proyectos/cronograma-rules.ts.
 */
import {
  estadoVisualTarea,
  eventosCalendario,
  fechasDeActividad,
  fechasDeSolicitud,
  type EstadoVisual,
  type EventoCalendario,
} from '../../../lib/proyectos/cronograma-rules';
import type { CronogramaDto } from '../../../lib/proyectos/tipos';

export interface ItemGantt {
  key: string;
  kind: 'tarea' | 'solicitud' | 'actividad';
  /** id de la tarea, número de la solicitud o id de la actividad. */
  id: number;
  titulo: string;
  subtitulo: string | null;
  inicio: string;
  fin: string;
  estado: EstadoVisual;
  progreso: number | null;
  hito: boolean;
  /** Fecha objetivo de una solicitud (se marca con un rombo hueco). */
  objetivo: string | null;
  /** Para las actividades: la solicitud a la que pertenecen. */
  padre: string | null;
  hijos: number;
}

export interface GrupoGantt {
  key: string;
  titulo: string;
  items: ItemGantt[];
}

export function itemsDeCronograma(c: CronogramaDto): { tareas: ItemGantt[]; solicitudes: ItemGantt[] } {
  const tareas = c.tasks.map<ItemGantt>((t) => ({
    key: `t${t.id}`,
    kind: 'tarea',
    id: t.id,
    titulo: t.title,
    subtitulo: t.responsible?.name ?? null,
    inicio: t.startDate,
    fin: t.endDate,
    estado: estadoVisualTarea(t, c.hoy),
    progreso: t.progress,
    hito: t.isMilestone,
    objetivo: null,
    padre: null,
    hijos: 0,
  }));
  const solicitudes: ItemGantt[] = [];
  for (const s of c.requests) {
    const f = fechasDeSolicitud(s, c.hoy);
    const key = `s${s.idRequest}`;
    solicitudes.push({
      key,
      kind: 'solicitud',
      id: s.idRequest,
      titulo: `#${s.idRequest} ${s.subject}`,
      subtitulo: [s.estado, s.processName].filter(Boolean).join(' · ') || null,
      inicio: f.inicio,
      fin: f.fin,
      estado: f.estadoVisual,
      progreso: null,
      hito: false,
      objetivo: s.targetDate,
      padre: null,
      hijos: s.actividades.length,
    });
    for (const a of s.actividades) {
      const fa = fechasDeActividad(a, f.inicio, c.hoy);
      solicitudes.push({
        key: `a${a.id}`,
        kind: 'actividad',
        id: a.id,
        titulo: a.task,
        subtitulo: [a.status, a.assignedTo].filter(Boolean).join(' · ') || null,
        inicio: fa.inicio,
        fin: fa.fin,
        estado: fa.estadoVisual,
        progreso: null,
        hito: false,
        objetivo: null,
        padre: key,
        hijos: 0,
      });
    }
  }
  return { tareas, solicitudes };
}

/** Grupos del Gantt: «Tareas» y «Solicitudes», o un grupo por responsable. */
export function gruposGantt(c: CronogramaDto, porResponsable: boolean): GrupoGantt[] {
  const { tareas, solicitudes } = itemsDeCronograma(c);
  const grupos: GrupoGantt[] = [];
  if (porResponsable) {
    const mapa = new Map<string, ItemGantt[]>();
    for (const t of tareas) {
      const k = t.subtitulo ?? 'Sin responsable';
      mapa.set(k, [...(mapa.get(k) ?? []), t]);
    }
    const nombres = [...mapa.keys()].sort((a, b) => (a === 'Sin responsable' ? 1 : b === 'Sin responsable' ? -1 : a.localeCompare(b, 'es')));
    for (const n of nombres) grupos.push({ key: `r-${n}`, titulo: n, items: mapa.get(n)! });
  } else if (tareas.length > 0) {
    grupos.push({ key: 'tareas', titulo: 'Tareas', items: tareas });
  }
  if (solicitudes.length > 0) grupos.push({ key: 'solicitudes', titulo: 'Solicitudes vinculadas', items: solicitudes });
  return grupos;
}

export function eventosDeCronograma(c: CronogramaDto): EventoCalendario[] {
  return eventosCalendario(c.tasks, c.requests, c.hoy);
}

/** Variables de color de Mantine para un estado (fondo claro, sólido y borde). */
export function coloresDe(estado: EstadoVisual, color: string): Record<string, string> {
  return {
    '--color-fondo': `var(--mantine-color-${color}-light)`,
    '--color-solido': `var(--mantine-color-${color}-filled)`,
    '--color-borde': estado === 'vencida' ? `var(--mantine-color-${color}-filled)` : 'transparent',
  };
}
