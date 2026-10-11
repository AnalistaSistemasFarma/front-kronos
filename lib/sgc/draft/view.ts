/**
 * Presentación del BORRADOR VIGENTE en el detalle de la solicitud documental
 * (solo lectura; funciones PURAS). No cambia qué borrador es el vigente —eso
 * lo decide pickCurrentDraft en ./current.ts—, solo ayuda a que el revisor y
 * el aprobador vean con claridad QUÉ documento revisar tras una devolución:
 * tarjeta destacada, aviso de ronda, etiquetas VIGENTE/REEMPLAZADO en los
 * adjuntos, aviso de borrador duplicado y el regreso a la tarea de origen.
 */

export interface SgcDraftViewDraft {
  kind: string;
  ref: string;
  name: string;
  sha256: string;
  format: string;
  at: string;
}

export interface SgcDraftViewAttachment {
  id: number;
  fileName: string;
  purpose: string;
  sha256: string;
  uploadedBy: string | null;
  createdAt: string;
  withdrawnAt: string | null;
}

export interface SgcDraftViewRevision {
  id: number;
  number: number;
  savedBy: string | null;
  savedAt: string;
}

export interface SgcDraftViewInteraction {
  kind: string;
  author: string | null;
  body: string;
  createdAt: string;
  idTask: number | null;
}

export interface SgcDraftViewTask {
  id: number;
  key: string;
  name: string;
  round: number;
  status: string;
}

/** Etiqueta de un adjunto «borrador» frente al borrador vigente (null si no aplica). */
export type SgcAttachmentDraftLabel = 'vigente' | 'reemplazado' | null;

export function attachmentDraftLabel(att: Pick<SgcDraftViewAttachment, 'id' | 'purpose' | 'withdrawnAt'>, currentDraft: Pick<SgcDraftViewDraft, 'kind' | 'ref'> | null): SgcAttachmentDraftLabel {
  if (att.purpose !== 'borrador' || att.withdrawnAt) return null;
  if (currentDraft && currentDraft.kind === 'borrador_adjunto' && currentDraft.ref === `adjunto:${att.id}`) return 'vigente';
  // Si el vigente es del editor de la app (o es otro adjunto), este Word/PDF ya no es lo que se firma.
  return currentDraft ? 'reemplazado' : null;
}

/** Título de la tarjeta según la tarea abierta. */
export function draftCardTitle(taskKey: string | null | undefined): string {
  if (taskKey === 'revision') return 'Documento a revisar';
  if (taskKey === 'aprobacion') return 'Documento a aprobar';
  if (taskKey === 'elaboracion') return 'Documento a elaborar';
  return 'Borrador vigente';
}

export interface SgcDraftSummary {
  name: string;
  origin: string;
  author: string | null;
  at: string;
  shortSha: string;
  sha256: string;
}

/** Resumen del borrador vigente: nombre, origen (editor · revisión N / archivo Word o PDF), autor, fecha y SHA corto. */
export function summarizeCurrentDraft(draft: SgcDraftViewDraft | null, attachments: readonly SgcDraftViewAttachment[], revisions: readonly SgcDraftViewRevision[]): SgcDraftSummary | null {
  if (!draft) return null;
  const id = Number(draft.ref.split(':')[1]);
  let origin: string;
  let author: string | null = null;
  if (draft.kind === 'borrador_editor') {
    const rev = revisions.find((r) => r.id === id);
    origin = rev ? `Editor de la app · revisión ${rev.number}` : 'Editor de la app';
    author = rev?.savedBy ?? null;
  } else {
    const att = attachments.find((a) => a.id === id);
    origin = draft.format === 'pdf' ? 'Archivo PDF cargado' : 'Archivo Word cargado';
    author = att?.uploadedBy ?? null;
  }
  return { name: draft.name, origin, author, at: draft.at, shortSha: draft.sha256.slice(0, 12), sha256: draft.sha256 };
}

/** Observaciones de una interacción «devolucion» (texto tras «Observaciones:»). */
export function devolutionObservations(body: string): string | null {
  const m = /(?:^|\n)Observaciones: ([\s\S]*?)(?=\n(?:Firma electrónica|Punto de firma|Lista de chequeo)|$)/.exec(body);
  const text = m?.[1]?.trim();
  return text ? text : null;
}

/** Paso desde el que se devolvió («Revisión», «Aprobación»…), tomado del texto de la interacción. */
export function devolutionStep(body: string): string | null {
  return /en «([^»]+)»/.exec(body)?.[1] ?? null;
}

export interface SgcRoundNotice {
  round: number;
  returnedBy: string;
  returnedAt: string;
  fromStep: string | null;
  observations: string | null;
  changes: string[];
}

/**
 * Aviso de ronda: si la solicitud viene de una devolución, quién la devolvió,
 * cuándo, con qué observaciones y qué cambió en el borrador desde entonces.
 * `round` es la ronda de la tarea abierta (o, si no la hay, la mayor ronda de
 * la Elaboración).
 */
export function buildRoundNotice(input: {
  openTask: Pick<SgcDraftViewTask, 'key' | 'round'> | null;
  tasks: readonly SgcDraftViewTask[];
  interactions: readonly SgcDraftViewInteraction[];
  attachments: readonly SgcDraftViewAttachment[];
  revisions: readonly SgcDraftViewRevision[];
}): SgcRoundNotice | null {
  const elabRound = Math.max(0, ...input.tasks.filter((t) => t.key === 'elaboracion').map((t) => t.round));
  const round = Math.max(input.openTask?.round ?? 0, elabRound);
  if (round <= 1) return null;
  const devs = input.interactions.filter((i) => i.kind === 'devolucion');
  const last = devs.at(-1);
  if (!last) return null;
  const since = new Date(last.createdAt).getTime();
  const changes: string[] = [];
  const newRevs = input.revisions.filter((r) => new Date(r.savedAt).getTime() > since);
  if (newRevs.length) {
    const lastRev = newRevs.reduce((a, b) => (b.number > a.number ? b : a));
    changes.push(`${lastRev.savedBy ?? 'El elaborador'} editó el borrador en la app (revisión ${lastRev.number}).`);
  }
  input.attachments
    .filter((a) => a.purpose === 'borrador' && !a.withdrawnAt && new Date(a.createdAt).getTime() > since)
    .forEach((a) => changes.push(`${a.uploadedBy ?? 'El elaborador'} subió un archivo nuevo: ${a.fileName}.`));
  if (!changes.length) changes.push('El borrador no ha cambiado desde la devolución.');
  return {
    round,
    returnedBy: last.author ?? 'Sin nombre',
    returnedAt: last.createdAt,
    fromStep: devolutionStep(last.body),
    observations: devolutionObservations(last.body),
    changes,
  };
}

/** Adjuntos (no retirados) de la solicitud con el mismo SHA-256 que el archivo nuevo. */
export function findDuplicateBySha<T extends { sha256: string; withdrawn_at?: Date | null }>(rows: readonly T[], sha256: string): T[] {
  const sha = sha256.trim().toLowerCase();
  return rows.filter((r) => !r.withdrawn_at && r.sha256.trim().toLowerCase() === sha);
}

// ── Regreso a la tarea de origen ─────────────────────────────────────────

/** Solo se acepta un id de tarea entero positivo: nunca una URL (no hay redirección abierta). */
export function parseTaskParam(value: string | null | undefined): number | null {
  if (!value || !/^\d{1,10}$/.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** Enlace al borrador editado en la app; si se abre desde una tarea, la lleva en `tarea=<id>`. */
export function draftEditorHref(idRequest: number, idCompany: number, idTask?: number | null, idRevision?: number | null): string {
  const q = new URLSearchParams({ empresa: String(idCompany) });
  if (idRevision) q.set('ver', String(idRevision));
  if (idTask) q.set('tarea', String(idTask));
  return `/process/sgc-documental/solicitudes/${idRequest}/borrador?${q.toString()}`;
}

/** «Volver» desde el borrador: a la tarea de origen si vino de una tarea; si no, a la solicitud. */
export function draftBackTarget(idRequest: number, idCompany: number, tareaParam: string | null | undefined): { href: string; label: string; crumb: string } {
  const idTask = parseTaskParam(tareaParam);
  if (idTask) return { href: `/process/sgc-documental/tareas/${idTask}?empresa=${idCompany}`, label: 'Volver a la tarea', crumb: `Tarea #${idTask}` };
  return { href: `/process/sgc-documental/solicitudes/${idRequest}?empresa=${idCompany}`, label: 'Volver a la solicitud', crumb: `Solicitud #${idRequest}` };
}
