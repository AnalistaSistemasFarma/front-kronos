/**
 * PROPUESTAS de los agentes sobre un proyecto (2026-10-18) — reglas PURAS.
 *
 * Un agente NUNCA cambia un proyecto: deja una propuesta 'pendiente' y una
 * PERSONA la confirma con un clic en SynerLink. Al confirmar, la acción se
 * ejecuta con los permisos de quien confirma (rol en el proyecto y visibilidad
 * de solicitudes), revalidados en ese momento: el agente no gana ningún
 * permiso que la persona no tenga.
 *
 * Dos orígenes:
 *   'puente' — el modelo de una conversación DEL PROYECTO escribe
 *              ./trabajo/propuestas-cronograma.json; el puente la entrega con
 *              su llave (el modelo nunca la ve). Solo tareas. La confirma
 *              cualquier dueño o editor.
 *   'mcp'    — un agente por kronos-mcp, con la CONCESIÓN de 24 h de una
 *              persona (chat_project_grant). La confirma SOLO esa persona.
 */
import { esFechaIso, isTaskStatus, MAX_TASK_DESCRIPTION_CHARS, MAX_TASK_TITLE_CHARS, TASK_STATUS_LABELS } from './cronograma-rules';

export const PROPOSAL_KINDS = [
  'tarea_crear',
  'tarea_editar',
  'solicitud_vincular',
  'solicitud_desvincular',
  'conversacion_crear',
  'miembro_invitar',
] as const;
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];

export const PROPOSAL_KIND_LABELS: Record<ProposalKind, string> = {
  tarea_crear: 'Crear tarea',
  tarea_editar: 'Cambiar tarea',
  solicitud_vincular: 'Vincular solicitud',
  solicitud_desvincular: 'Quitar solicitud',
  conversacion_crear: 'Abrir conversación',
  miembro_invitar: 'Invitar miembro',
};

/** El puente solo propone tareas (crear o cambiar estado, avance o fechas). */
export const PUENTE_KINDS: readonly ProposalKind[] = ['tarea_crear', 'tarea_editar'];

export type ProposalStatus = 'pendiente' | 'ejecutando' | 'confirmada' | 'rechazada' | 'vencida' | 'fallida';
export type ProposalSource = 'puente' | 'mcp';

/** Una propuesta del puente vive 7 días; una del MCP, lo que le quede a la concesión. */
export const PROPOSAL_TTL_MS = 7 * 24 * 60 * 60_000;
/** Propuestas pendientes por proyecto (todas las fuentes). */
export const MAX_PENDING_PROPOSALS = 30;
/** Propuestas que el puente entrega en un turno. */
export const MAX_PROPOSALS_PER_TURN = 10;
export const MAX_PROPOSAL_SUMMARY_CHARS = 500;

export function isProposalKind(v: unknown): v is ProposalKind {
  return typeof v === 'string' && (PROPOSAL_KINDS as readonly string[]).includes(v);
}

/** Rol que hace falta para CONFIRMAR (y para que el agente pueda proponer a nombre de alguien). */
export function rolNecesario(kind: ProposalKind): 'contribute' | 'manageMembers' {
  return kind === 'miembro_invitar' ? 'manageMembers' : 'contribute';
}

export type Validacion<T> = { ok: true; value: T } | { ok: false; error: string };

/** Payload ya validado, por tipo. Las fechas van en AAAA-MM-DD. */
export type PayloadTarea = {
  title?: string;
  description?: string | null;
  /** Correo o nombre EXACTO del responsable: el SERVIDOR lo resuelve a un miembro del proyecto. */
  responsable?: string | null;
  startDate?: string;
  endDate?: string | null;
  status?: string;
  progress?: number | null;
  isMilestone?: boolean;
};

export type Payload =
  | { kind: 'tarea_crear'; tarea: PayloadTarea }
  | { kind: 'tarea_editar'; idTask: number; tarea: PayloadTarea }
  | { kind: 'solicitud_vincular'; idRequest: number }
  | { kind: 'solicitud_desvincular'; idRequest: number }
  | { kind: 'conversacion_crear'; agentCode: string; title: string | null }
  | { kind: 'miembro_invitar'; email: string; role: 'editor' | 'reader' };

const CORREO_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

function entero(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v > 0 && v < 2_147_483_647 ? v : null;
}

/** Valida solo la FORMA de los campos de una tarea propuesta (la regla completa se aplica al confirmar). */
export function validarTareaPropuesta(raw: unknown, nueva: boolean): Validacion<PayloadTarea> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, error: 'La tarea propuesta no es válida.' };
  const r = raw as Record<string, unknown>;
  const t: PayloadTarea = {};
  if (r.title !== undefined || nueva) {
    if (typeof r.title !== 'string' || !r.title.trim()) return { ok: false, error: 'La tarea propuesta necesita un título.' };
    t.title = r.title.replace(/\s+/g, ' ').trim().slice(0, MAX_TASK_TITLE_CHARS);
  }
  if (r.description !== undefined && r.description !== null) {
    if (typeof r.description !== 'string') return { ok: false, error: 'La descripción debe ser texto.' };
    t.description = r.description.replace(/\r\n/g, '\n').trim().slice(0, MAX_TASK_DESCRIPTION_CHARS) || null;
  }
  if (r.responsable !== undefined && r.responsable !== null && r.responsable !== '') {
    if (typeof r.responsable !== 'string' || !r.responsable.trim() || r.responsable.length > 254) return { ok: false, error: 'El responsable debe ser el correo o el nombre de un miembro.' };
    t.responsable = r.responsable.replace(/\s+/g, ' ').trim();
  }
  if (r.startDate !== undefined || nueva) {
    if (!esFechaIso(r.startDate)) return { ok: false, error: 'La fecha de inicio debe ir en AAAA-MM-DD.' };
    t.startDate = r.startDate;
  }
  if (r.endDate !== undefined && r.endDate !== null && r.endDate !== '') {
    if (!esFechaIso(r.endDate)) return { ok: false, error: 'La fecha de fin debe ir en AAAA-MM-DD.' };
    t.endDate = r.endDate;
  }
  if (r.status !== undefined) {
    if (!isTaskStatus(r.status)) return { ok: false, error: 'El estado debe ser pendiente, en_curso, hecha o bloqueada.' };
    t.status = r.status;
  }
  if (r.progress !== undefined && r.progress !== null) {
    if (typeof r.progress !== 'number' || !Number.isInteger(r.progress) || r.progress < 0 || r.progress > 100) {
      return { ok: false, error: 'El avance debe ser un entero entre 0 y 100.' };
    }
    t.progress = r.progress;
  }
  if (r.isMilestone !== undefined) {
    if (typeof r.isMilestone !== 'boolean') return { ok: false, error: 'Hito debe ser verdadero o falso.' };
    t.isMilestone = r.isMilestone;
  }
  if (!nueva && Object.keys(t).length === 0) return { ok: false, error: 'La propuesta no cambia nada.' };
  if (t.startDate && t.endDate && t.endDate < t.startDate) return { ok: false, error: 'La fecha de fin no puede ser anterior a la de inicio.' };
  return { ok: true, value: t };
}

/** Valida una propuesta completa ({ kind, ... }). */
export function validarPropuesta(raw: unknown, permitidos: readonly ProposalKind[] = PROPOSAL_KINDS): Validacion<Payload> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, error: 'Propuesta inválida.' };
  const r = raw as Record<string, unknown>;
  if (!isProposalKind(r.kind) || !permitidos.includes(r.kind)) return { ok: false, error: 'Ese tipo de propuesta no está permitido aquí.' };
  switch (r.kind) {
    case 'tarea_crear': {
      const t = validarTareaPropuesta(r.tarea, true);
      return t.ok ? { ok: true, value: { kind: 'tarea_crear', tarea: t.value } } : t;
    }
    case 'tarea_editar': {
      const id = entero(r.idTask);
      if (!id) return { ok: false, error: 'Falta el número de la tarea.' };
      const t = validarTareaPropuesta(r.tarea, false);
      return t.ok ? { ok: true, value: { kind: 'tarea_editar', idTask: id, tarea: t.value } } : t;
    }
    case 'solicitud_vincular':
    case 'solicitud_desvincular': {
      const id = entero(r.idRequest);
      if (!id) return { ok: false, error: 'Falta el número de la solicitud.' };
      return { ok: true, value: { kind: r.kind, idRequest: id } };
    }
    case 'conversacion_crear': {
      const code = typeof r.agentCode === 'string' ? r.agentCode.trim().toLowerCase() : '';
      if (!/^[a-z0-9_-]{1,60}$/.test(code)) return { ok: false, error: 'Asistente inválido.' };
      const title = typeof r.title === 'string' ? r.title.replace(/\s+/g, ' ').trim().slice(0, 120) || null : null;
      return { ok: true, value: { kind: 'conversacion_crear', agentCode: code, title } };
    }
    case 'miembro_invitar': {
      const email = typeof r.email === 'string' ? r.email.trim().toLowerCase() : '';
      if (!CORREO_RE.test(email)) return { ok: false, error: 'Correo inválido.' };
      if (r.role !== 'editor' && r.role !== 'reader') return { ok: false, error: 'El rol debe ser editor o lector.' };
      return { ok: true, value: { kind: 'miembro_invitar', email, role: r.role } };
    }
  }
  return { ok: false, error: 'Propuesta inválida.' };
}

/** Texto corto de la propuesta para la tarjeta y la auditoría. */
export function resumenPropuesta(p: Payload, extra: { tituloTarea?: string | null; asuntoSolicitud?: string | null } = {}): string {
  const fechas = (t: PayloadTarea) => [t.startDate, t.endDate && t.endDate !== t.startDate ? t.endDate : null].filter(Boolean).join(' → ');
  let s: string;
  switch (p.kind) {
    case 'tarea_crear': {
      const t = p.tarea;
      s = `${t.isMilestone ? 'Hito' : 'Tarea'} «${t.title}» (${fechas(t)})${t.responsable ? `, responsable ${t.responsable}` : ''}${t.status ? `, ${TASK_STATUS_LABELS[t.status as keyof typeof TASK_STATUS_LABELS] ?? t.status}` : ''}`;
      break;
    }
    case 'tarea_editar': {
      const t = p.tarea;
      const partes: string[] = [];
      if (t.status) partes.push(`estado: ${TASK_STATUS_LABELS[t.status as keyof typeof TASK_STATUS_LABELS] ?? t.status}`);
      if (t.progress !== undefined && t.progress !== null) partes.push(`avance: ${t.progress} %`);
      if (t.startDate || t.endDate) partes.push(`fechas: ${fechas(t) || t.endDate}`);
      if (t.title) partes.push(`título: «${t.title}»`);
      if (t.responsable) partes.push(`responsable: ${t.responsable}`);
      if (t.description !== undefined) partes.push('descripción');
      if (t.isMilestone !== undefined) partes.push(`hito: ${t.isMilestone ? 'sí' : 'no'}`);
      s = `Tarea «${extra.tituloTarea ?? `#${p.idTask}`}» → ${partes.join(', ')}`;
      break;
    }
    case 'solicitud_vincular':
      s = `Vincular la solicitud #${p.idRequest}${extra.asuntoSolicitud ? ` «${extra.asuntoSolicitud}»` : ''}`;
      break;
    case 'solicitud_desvincular':
      s = `Quitar del proyecto la solicitud #${p.idRequest}${extra.asuntoSolicitud ? ` «${extra.asuntoSolicitud}»` : ''}`;
      break;
    case 'conversacion_crear':
      s = `Abrir una conversación con ${p.agentCode}${p.title ? ` «${p.title}»` : ''}`;
      break;
    case 'miembro_invitar':
      s = `Invitar a ${p.email} como ${p.role === 'reader' ? 'lector' : 'editor'}`;
      break;
  }
  return s.length > MAX_PROPOSAL_SUMMARY_CHARS ? `${s.slice(0, MAX_PROPOSAL_SUMMARY_CHARS - 1)}…` : s;
}

/**
 * ¿Quién puede confirmar? Puente: cualquier dueño o editor (y el dueño, además,
 * las invitaciones). MCP: SOLO la persona a cuyo nombre actuó el agente, y con
 * el rol que la acción exige.
 */
export function puedeConfirmar(
  p: { source: ProposalSource; requestedFor: string | null; kind: ProposalKind },
  quien: { id: string; caps: { contribute: boolean; manageMembers: boolean } }
): { ok: true } | { ok: false; motivo: string } {
  if (p.source === 'mcp' && p.requestedFor !== quien.id) {
    return { ok: false, motivo: 'Solo la persona que se la pidió al asistente puede confirmarla.' };
  }
  if (!quien.caps[rolNecesario(p.kind)]) {
    return { ok: false, motivo: p.kind === 'miembro_invitar' ? 'Solo el dueño del proyecto puede invitar.' : 'Su rol en el proyecto no permite hacer cambios.' };
  }
  return { ok: true };
}
