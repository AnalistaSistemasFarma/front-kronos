/**
 * Flujo completo de un documento (2026-11-11, botón «Ver flujo» de Autorizaciones): solicitud creada →
 * Word en elaboración → validación del Word → revisión del cliente → PDF → validación del PDF → firmas →
 * firmado, con el historial de cada paso (versiones, envíos, rondas, devoluciones, plazos).
 *
 * PRIVACIDAD (decisión de Juan, 2026-11-11, reemplaza la de ocultar el progreso del 2026-09-14):
 * NOMBRES, ESTADO y FECHA. Nunca correos, cédulas, comentarios, motivos de devolución ni enlaces.
 * Los correos se cambian por nombres con el mapa `names` (lo arma el servidor desde [user]); si no hay
 * nombre, se muestra el papel («Firmante 2») o no se muestra quién. Función pura con pruebas.
 */
import type {
  OrionDraftClientReview,
  OrionDraftState,
  OrionReviewApproval,
  OrionReviewState,
  OrionSignatureBagBag,
  OrionSignatureState,
} from './types';
import { getCurrentPendingSigner, isSignerRejected, isSignerSlotCompleted, orderedSigners } from './signerStatus';

export type FlowStatus = 'hecho' | 'actual' | 'pendiente' | 'devuelto';
export type FlowPersonStatus = FlowStatus | 'rechazado';

export interface FlowPerson {
  name: string;
  role: string;
  status: FlowPersonStatus;
  statusLabel: string;
  at: string | null;
  /** Dato extra corto: «Plazo hasta…», «Pidió más plazo». */
  detail: string | null;
}

/** Línea del historial de un paso: qué pasó, quién (nombre) y cuándo. */
export interface FlowEvent {
  label: string;
  who: string | null;
  at: string | null;
}

export interface FlowStage {
  key: string;
  title: string;
  description: string | null;
  status: FlowStatus;
  at: string | null;
  people: FlowPerson[];
  events: FlowEvent[];
}

export interface DocumentFlow {
  fileName: string | null;
  stages: FlowStage[];
  currentStageKey: string | null;
  currentLabel: string | null;
  doneCount: number;
  total: number;
}

export interface DocumentFlowExtra {
  /** Datos de la solicitud (paso «Solicitud creada»). */
  request?: { createdAt: string | null; requesterName: string | null } | null;
  /** correo (minúsculas) → nombre, para no mostrar correos. */
  names?: Record<string, string>;
}

const AFTER_WORD_VALIDATION = new Set(['VALIDADO_INTERNO', 'EN_REVISION_CLIENTE', 'RECHAZADO_CLIENTE', 'APROBADO_CLIENTE', 'CONVERTIDO_PDF']);

const VERSION_KIND: Record<string, string> = {
  elaboracion: 'versión de trabajo',
  validacion: 'versión para validar',
  borrador_cliente: 'borrador para el cliente',
  pdf: 'PDF generado',
};

function validDate(value: string | null | undefined): string | null {
  return value && !Number.isNaN(Date.parse(value)) ? value : null;
}

function latest(dates: Array<string | null | undefined>): string | null {
  const valid = dates.map(validDate).filter((d): d is string => Boolean(d));
  if (!valid.length) return null;
  return valid.sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;
}

function byDate<T extends { at: string | null }>(items: T[]): T[] {
  return [...items].sort((a, b) => (a.at ? Date.parse(a.at) : Infinity) - (b.at ? Date.parse(b.at) : Infinity));
}

function formatDeadline(value: string | null | undefined): string | null {
  const d = validDate(value);
  if (!d) return null;
  return new Date(d).toLocaleString('es-CO', {
    timeZone: 'America/Bogota',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function makeNamer(names: Record<string, string> = {}) {
  const clean = (value: string | null | undefined): string | null => {
    const v = String(value ?? '').trim();
    if (!v) return null;
    if (v.includes('@')) return names[v.toLowerCase()]?.trim() || null;
    return v;
  };
  /** Nombre visible: el guardado, o el de [user] por correo, o el papel. Nunca un correo. */
  const person = (name: string | null | undefined, email: string | null | undefined, fallback: string): string =>
    clean(name) || clean(email) || fallback;
  return { clean, person };
}

type Namer = ReturnType<typeof makeNamer>;

function validatorPeople(approvals: OrionReviewApproval[], stageActive: boolean, n: Namer): FlowPerson[] {
  return [...approvals]
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((a, i) => {
      const name = n.person(a.name, a.email, `Validador ${a.order || i + 1}`);
      const role = 'Validador';
      if (a.decision === 'APROBADO') return { name, role, status: 'hecho', statusLabel: 'Aprobó', at: a.decidedAt ?? null, detail: null };
      if (a.decision === 'DEVUELTO') return { name, role, status: 'devuelto', statusLabel: 'Pidió corrección', at: a.decidedAt ?? null, detail: null };
      return stageActive
        ? { name, role, status: 'actual', statusLabel: 'Revisando', at: null, detail: null }
        : { name, role, status: 'pendiente', statusLabel: 'En espera', at: null, detail: null };
    });
}

function reviewEvents(review: OrionReviewState, n: Namer): FlowEvent[] {
  const round = review.round && review.round > 1 ? ` (ronda ${review.round})` : '';
  const events: FlowEvent[] = [];
  if (validDate(review.submittedAt)) events.push({ label: `Enviado a validación${round}`, who: n.clean(review.submittedBy), at: review.submittedAt ?? null });
  if (validDate(review.returnedAt)) events.push({ label: 'Devuelto para corrección', who: n.clean(review.returnedBy), at: review.returnedAt ?? null });
  if (validDate(review.approvedAt)) events.push({ label: 'Aprobado por todos los validadores', who: null, at: review.approvedAt ?? null });
  return byDate(events);
}

function findDraft(bag: OrionSignatureBagBag, fileId: string): OrionDraftState | null {
  const drafts = bag.drafts ?? {};
  if (drafts[fileId]) return drafts[fileId] ?? null;
  return Object.values(drafts).find((d) => d.pdfFileId === fileId) ?? null;
}

function wordStages(draft: OrionDraftState, n: Namer): FlowStage[] {
  const status = draft.status;
  const stages: FlowStage[] = [];
  const versions = [...(draft.versions ?? [])].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const preparer = n.person(versions[0]?.uploadedByName, draft.createdByEmail, 'Preparadora');
  const correcting = status === 'DEVUELTO_INTERNO' || status === 'RECHAZADO_CLIENTE';
  const preparing = status === 'EN_ELABORACION' || correcting;
  stages.push({
    key: 'word',
    title: 'Preparación en Word',
    description: preparing
      ? draft.internalReview || correcting
        ? 'Corrigiendo el documento'
        : 'Elaborando el documento'
      : `${versions.filter((v) => v.kind !== 'pdf').length} ${versions.filter((v) => v.kind !== 'pdf').length === 1 ? 'versión' : 'versiones'}`,
    status: preparing ? (correcting ? 'devuelto' : 'actual') : 'hecho',
    at: draft.createdAt ?? null,
    people: [
      {
        name: preparer,
        role: 'Preparadora',
        status: preparing ? 'actual' : 'hecho',
        statusLabel: preparing ? (correcting ? 'Corrigiendo' : 'Elaborando') : 'Preparó',
        at: preparing ? null : draft.createdAt ?? null,
        detail: null,
      },
    ],
    events: versions
      .filter((v) => v.kind !== 'pdf')
      .map((v) => ({
        label: `${v.label} · ${VERSION_KIND[v.kind] ?? 'versión'}`,
        who: n.person(v.uploadedByName, v.uploadedByEmail, '') || null,
        at: v.createdAt ?? null,
      })),
  });

  const review = draft.internalReview;
  if (review && review.approvals.length > 0) {
    const active = status === 'EN_VALIDACION_INTERNA';
    stages.push({
      key: 'word-validacion',
      title: 'Validación del Word',
      description: `${review.approvals.filter((a) => a.decision === 'APROBADO').length} de ${review.approvals.length} aprobaron${
        review.round && review.round > 1 ? ` · ronda ${review.round}` : ''
      }`,
      status: active ? 'actual' : status === 'DEVUELTO_INTERNO' ? 'devuelto' : AFTER_WORD_VALIDATION.has(status) ? 'hecho' : 'pendiente',
      at: review.approvedAt ?? latest(review.approvals.map((a) => a.decidedAt)),
      people: validatorPeople(review.approvals, active, n),
      events: reviewEvents(review, n),
    });
  }

  const client = draft.clientReview;
  if (client && client.reviewers.length > 0) {
    const active = status === 'EN_REVISION_CLIENTE';
    const reviewers = [...client.reviewers].sort((a, b) => a.order - b.order);
    const firstPending = reviewers.find((r) => r.decision === 'PENDIENTE');
    const rounds: OrionDraftClientReview[] = [...(draft.clientReviewHistory ?? []), client];
    stages.push({
      key: 'cliente',
      title: 'Revisión del cliente',
      description: `${client.mode === 'sequential' ? 'En orden' : 'Al mismo tiempo'}${client.round > 1 ? ` · ronda ${client.round}` : ''}`,
      status: active ? 'actual' : status === 'RECHAZADO_CLIENTE' ? 'devuelto' : status === 'APROBADO_CLIENTE' || status === 'CONVERTIDO_PDF' ? 'hecho' : 'pendiente',
      at: client.closedAt ?? latest(reviewers.map((r) => r.decidedAt)),
      people: reviewers.map((r, i) => {
        const name = n.person(r.name, r.email, `Aprobador del cliente ${r.order || i + 1}`);
        const role = 'Cliente';
        if (r.decision === 'ACEPTADO') return { name, role, status: 'hecho' as const, statusLabel: 'Aceptó', at: r.decidedAt ?? null, detail: null };
        if (r.decision === 'RECHAZADO') return { name, role, status: 'rechazado' as const, statusLabel: 'Rechazó', at: r.decidedAt ?? null, detail: null };
        if (r.decision === 'ANULADO') return { name, role, status: 'pendiente' as const, statusLabel: 'Anulado', at: null, detail: null };
        const isTurn = active && (client.mode === 'parallel' || r === firstPending);
        const deadline = isTurn ? formatDeadline(r.expiresAt) : null;
        return {
          name,
          role,
          status: isTurn ? ('actual' as const) : ('pendiente' as const),
          statusLabel: isTurn ? 'Revisando' : 'En espera',
          at: isTurn ? r.sentAt ?? null : null,
          detail: deadline ? `Enlace vigente hasta ${deadline}` : null,
        };
      }),
      events: byDate(
        rounds.flatMap((round) => [
          { label: `Ronda ${round.round} enviada al cliente (${round.versionLabel})`, who: n.clean(round.submittedBy), at: validDate(round.submittedAt) },
          ...(validDate(round.closedAt) ? [{ label: `Ronda ${round.round} cerrada`, who: null, at: round.closedAt ?? null }] : []),
        ])
      ),
    });
  }

  const pdfVersion = versions.find((v) => v.kind === 'pdf');
  stages.push({
    key: 'pdf',
    title: 'Conversión a PDF',
    description: status === 'CONVERTIDO_PDF' ? 'El PDF queda listo para validar y firmar' : null,
    status: status === 'CONVERTIDO_PDF' ? 'hecho' : 'pendiente',
    at: status === 'CONVERTIDO_PDF' ? pdfVersion?.createdAt ?? draft.updatedAt ?? null : null,
    people: [],
    events: pdfVersion ? [{ label: 'PDF generado', who: n.person(pdfVersion.uploadedByName, pdfVersion.uploadedByEmail, '') || null, at: pdfVersion.createdAt }] : [],
  });
  return stages;
}

function pdfStages(doc: OrionSignatureState | null, n: Namer): FlowStage[] {
  const stages: FlowStage[] = [];
  const review = doc?.review;
  if (doc && review && review.approvals.length > 0 && !doc.skipValidation) {
    const inherited = review.source === 'word';
    const active = !inherited && review.status === 'EN_VALIDACION';
    stages.push({
      key: 'pdf-validacion',
      title: 'Validación del PDF',
      description: inherited
        ? 'Aprobada en el Word: los validadores ubican su visto bueno'
        : `${review.approvals.filter((a) => a.decision === 'APROBADO').length} de ${review.approvals.length} aprobaron${
            review.round && review.round > 1 ? ` · ronda ${review.round}` : ''
          }`,
      status: inherited || review.status === 'APROBADO' ? 'hecho' : active ? 'actual' : review.status === 'DEVUELTO_CORRECCION' ? 'devuelto' : 'pendiente',
      at: review.approvedAt ?? latest(review.approvals.map((a) => a.decidedAt)),
      people: validatorPeople(review.approvals, active, n),
      events: reviewEvents(review, n),
    });
  }

  const signers = orderedSigners(doc?.signers);
  const current = getCurrentPendingSigner(signers);
  const rejected = signers.some((s) => isSignerRejected(s.status));
  const allDone = signers.length > 0 && signers.every((s) => isSignerSlotCompleted(s));
  const docStatus = String(doc?.status ?? '').toUpperCase();
  const started = signers.length > 0 && docStatus !== '' && docStatus !== 'BORRADOR';
  const validationOpen = stages.some((s) => s.status !== 'hecho');
  const signingActive = started && !allDone && !rejected && !validationOpen;
  const signedCount = signers.filter((s) => isSignerSlotCompleted(s)).length;
  const firstTurn = latest([signers[0]?.turnStartedAt]);

  const events: FlowEvent[] = [];
  if (started && firstTurn) events.push({ label: 'Enviado a firmar', who: null, at: firstTurn });
  for (const s of signers) {
    const name = n.person(s.name, s.email, '');
    if (validDate(s.extensionRequestedAt)) events.push({ label: 'Pidió más plazo para firmar', who: name || null, at: s.extensionRequestedAt ?? null });
  }
  for (const inv of doc?.signerInvites ?? []) {
    if (validDate(inv.sentAt)) events.push({ label: 'Enlace de firma enviado a firmante externo', who: n.person(inv.name, inv.email, '') || null, at: inv.sentAt ?? null });
  }
  for (const v of doc?.versions ?? []) {
    if (v.signerName || v.signerEmail) {
      events.push({ label: `Versión ${v.label} con su firma`, who: n.person(v.signerName, v.signerEmail, '') || null, at: v.createdAt ?? null });
    }
  }

  stages.push({
    key: 'firmas',
    title: 'Firmas',
    description: signers.length ? `${signedCount} de ${signers.length} firmaron${signers.length > 1 ? ' · en orden' : ''}` : 'Aún sin firmantes',
    status: allDone ? 'hecho' : rejected ? 'devuelto' : signingActive ? 'actual' : 'pendiente',
    at: allDone ? latest(signers.map((s) => s.signedAt)) : null,
    people: signers.map((s, i) => {
      const name = n.person(s.name, s.email, `Firmante ${s.order || i + 1}`);
      const role = s.type === 'external' ? 'Firmante externo' : 'Firmante';
      if (isSignerSlotCompleted(s)) return { name, role, status: 'hecho' as const, statusLabel: 'Firmó', at: s.signedAt ?? null, detail: null };
      if (isSignerRejected(s.status)) return { name, role, status: 'rechazado' as const, statusLabel: 'Rechazó', at: null, detail: null };
      if (signingActive && current && s === current) {
        const deadline = formatDeadline(s.expiresAt);
        return {
          name,
          role,
          status: 'actual' as const,
          statusLabel: 'Le toca',
          at: s.turnStartedAt ?? null,
          detail: validDate(s.extensionRequestedAt) ? 'Pidió más plazo' : deadline ? `Plazo hasta ${deadline}` : null,
        };
      }
      return { name, role, status: 'pendiente' as const, statusLabel: 'En espera', at: null, detail: null };
    }),
    events: byDate(events),
  });

  stages.push({
    key: 'firmado',
    title: 'Documento firmado',
    description: allDone ? 'Todas las firmas quedaron en el PDF' : null,
    status: allDone ? 'hecho' : 'pendiente',
    at: allDone ? doc?.signedAt ?? latest(signers.map((s) => s.signedAt)) : null,
    people: [],
    events: [],
  });
  return stages;
}

function describeCurrent(stage: FlowStage | undefined): string | null {
  if (!stage) return null;
  const active = stage.people.filter((p) => p.status === 'actual').map((p) => p.name);
  switch (stage.key) {
    case 'word':
      return stage.status === 'devuelto' ? 'Devuelto a la preparadora para corregir' : 'La preparadora está elaborando el Word';
    case 'word-validacion':
    case 'pdf-validacion':
      if (stage.status === 'devuelto') return 'Devuelto para corrección';
      return active.length ? `Revisando: ${active.join(', ')}` : 'En validación';
    case 'cliente':
      if (stage.status === 'devuelto') return 'El cliente rechazó el borrador';
      return active.length ? `Esperando al cliente: ${active.join(', ')}` : 'Esperando al cliente';
    case 'firmas':
      if (stage.status === 'devuelto') return 'Un firmante rechazó el documento';
      return active.length ? `Le toca firmar a ${active[0]}` : 'En firmas';
    default:
      return stage.title;
  }
}

export function buildDocumentFlow(
  bag: OrionSignatureBagBag | null | undefined,
  fileId: string,
  extra: DocumentFlowExtra = {}
): DocumentFlow {
  const n = makeNamer(extra.names);
  const safeBag: OrionSignatureBagBag = bag ?? { documents: {} };
  const draft = findDraft(safeBag, fileId);
  const doc = safeBag.documents[fileId] ?? (draft?.pdfFileId ? safeBag.documents[draft.pdfFileId] : undefined) ?? null;

  const requestStage: FlowStage[] = extra.request
    ? [
        {
          key: 'solicitud',
          title: 'Solicitud creada',
          description: null,
          status: 'hecho',
          at: validDate(extra.request.createdAt),
          people: extra.request.requesterName
            ? [
                {
                  name: n.person(extra.request.requesterName, null, 'Solicitante'),
                  role: 'Solicitante',
                  status: 'hecho',
                  statusLabel: 'Creó la solicitud',
                  at: validDate(extra.request.createdAt),
                  detail: null,
                },
              ]
            : [],
          events: [],
        },
      ]
    : [];

  const stages = [...requestStage, ...(draft ? wordStages(draft, n) : []), ...pdfStages(doc, n)];
  const current = stages.find((s) => s.status === 'actual' || s.status === 'devuelto');
  return {
    fileName: doc?.fileName ?? draft?.fileName ?? null,
    stages,
    currentStageKey: current?.key ?? null,
    currentLabel: current ? describeCurrent(current) : stages.every((s) => s.status === 'hecho') ? 'Proceso terminado' : null,
    doneCount: stages.filter((s) => s.status === 'hecho').length,
    total: stages.length,
  };
}

/** Correos que aparecen en el flujo y conviene cambiar por nombre (los busca el servidor en [user]). */
export function emailsInFlow(bag: OrionSignatureBagBag | null | undefined, fileId: string): string[] {
  const safeBag: OrionSignatureBagBag = bag ?? { documents: {} };
  const draft = findDraft(safeBag, fileId);
  const doc = safeBag.documents[fileId] ?? (draft?.pdfFileId ? safeBag.documents[draft.pdfFileId] : undefined) ?? null;
  const out = new Set<string>();
  const add = (v: string | null | undefined) => {
    const e = String(v ?? '').trim().toLowerCase();
    if (e.includes('@') && e.length <= 320) out.add(e);
  };
  if (draft) {
    add(draft.createdByEmail);
    draft.versions?.forEach((v) => add(v.uploadedByEmail));
    add(draft.internalReview?.submittedBy);
    add(draft.internalReview?.returnedBy);
    draft.internalReview?.approvals.forEach((a) => add(a.email));
    [...(draft.clientReviewHistory ?? []), ...(draft.clientReview ? [draft.clientReview] : [])].forEach((r) => add(r.submittedBy));
  }
  if (doc) {
    add(doc.review?.submittedBy);
    add(doc.review?.returnedBy);
    doc.review?.approvals.forEach((a) => add(a.email));
    doc.signers?.forEach((s) => add(s.email));
  }
  return [...out].slice(0, 200);
}
