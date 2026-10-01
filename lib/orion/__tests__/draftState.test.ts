import { describe, expect, it } from 'vitest';
import {
  activeClientReviewers,
  applyDraftClientDecision,
  applyDraftConverted,
  applyDraftEditValidators,
  applyDraftInternalDecision,
  applyDraftNewVersion,
  applyDraftReviewerInvite,
  applyDraftSendClient,
  applyDraftSubmitInternal,
  createDraftState,
  draftCorrectionRequests,
  pendingDraftValidators,
  isWordDraftFileName,
  nextDraftVersionLabel,
  resolveDraftPermissions,
  type DraftActor,
} from '../draftState';
import {
  parseOrionSignatureBagBag,
  serializeOrionSignatureBagBag,
} from '../formValue';
import type { OrionReviewValidator } from '../reviewState';

const elaborador: DraftActor = { userId: 'u-ela', email: 'Ela@x.com', name: 'Ela' };
const otro: DraftActor = { userId: 'u-otro', email: 'otro@x.com', name: 'Otro' };
const ana: DraftActor = { userId: 'u-ana', email: 'ana@x.com', name: 'Ana' };
const beto: DraftActor = { userId: 'u-beto', email: 'beto@x.com', name: 'Beto' };
const validators: OrionReviewValidator[] = [
  { userId: 'u-ana', email: 'ana@x.com', name: 'Ana', order: 1 },
  { userId: 'u-beto', email: 'beto@x.com', name: 'Beto', order: 2 },
];

function version(id: string) {
  return {
    id,
    oneDriveItemId: `item-${id}`,
    fileName: 'Contrato.docx',
    uploadedByEmail: 'ela@x.com',
    createdAt: '2026-09-30T10:00:00.000Z',
  };
}

function nuevo() {
  return createDraftState({
    fileId: 'f1',
    fileName: 'Contrato.docx',
    actor: elaborador,
    firstVersion: version('a'),
  });
}

describe('preparación Word: versiones', () => {
  it('solo reconoce .docx', () => {
    expect(isWordDraftFileName('Contrato.DOCX')).toBe(true);
    expect(isWordDraftFileName('Contrato.pdf')).toBe(false);
    expect(isWordDraftFileName('Contrato.doc')).toBe(false);
  });

  it('numera v0.1 → v0.2 → … y nunca llega a v1', () => {
    expect(nextDraftVersionLabel('v0.1')).toBe('v0.2');
    expect(nextDraftVersionLabel('v0.9')).toBe('v0.10');
    expect(nextDraftVersionLabel(null)).toBe('v0.1');
  });

  it('arranca en elaboración con la versión v0.1', () => {
    const s = nuevo();
    expect(s.status).toBe('EN_ELABORACION');
    expect(s.versions.map((v) => [v.label, v.kind])).toEqual([['v0.1', 'elaboracion']]);
  });
});

describe('preparación Word: trabajo al mismo tiempo (sin bloqueo)', () => {
  it('cualquier preparadora sube sin tomar el documento', () => {
    const next = applyDraftNewVersion(nuevo(), { actor: elaborador, version: version('b') });
    expect(next.versionLabel).toBe('v0.2');
    const otra = applyDraftNewVersion(next, { actor: otro, version: version('c'), baseVersion: 'v0.2' });
    expect(otra.versionLabel).toBe('v0.3');
    const perms = resolveDraftPermissions({ state: nuevo(), actorEmail: 'otro@x.com', isElaborator: true });
    expect(perms).toMatchObject({ canUpload: true, canSubmitInternal: true, canViewBoard: true });
  });

  it('si otra persona subió primero, la subida sobre la versión vieja se rechaza', () => {
    const v2 = applyDraftNewVersion(nuevo(), { actor: elaborador, version: version('b'), baseVersion: 'v0.1' });
    expect(() => applyDraftNewVersion(v2, { actor: otro, version: version('c'), baseVersion: 'v0.1' })).toThrow(
      /se subió la v0\.2/
    );
  });

  it('quien no es preparadora ni validadora no ve el tablero ni sube', () => {
    const perms = resolveDraftPermissions({ state: nuevo(), actorEmail: 'otro@x.com', isElaborator: false });
    expect(perms).toMatchObject({ canViewBoard: false, canUpload: false, canSubmitInternal: false });
    expect(resolveDraftPermissions({ state: nuevo(), actorEmail: 'otro@x.com', isElaborator: false, isAdmin: true }).canViewBoard).toBe(true);
  });

  it('solicitud cerrada: nadie modifica nada, solo se puede ver el tablero', () => {
    const perms = resolveDraftPermissions({
      state: nuevo(),
      actorEmail: 'ela@x.com',
      isElaborator: true,
      workflowLocked: true,
    });
    const allowed = Object.entries(perms).filter(([, v]) => v === true).map(([k]) => k);
    expect(allowed).toEqual(['canViewBoard']);
  });
});

describe('preparación Word: validación interna', () => {
  function enValidacion() {
    return applyDraftSubmitInternal(nuevo(), { actor: elaborador, validators });
  }

  it('en validación la preparadora corrige y sube mientras los validadores revisan', () => {
    const s = enValidacion();
    expect(s.status).toBe('EN_VALIDACION_INTERNA');
    expect(pendingDraftValidators(s).map((a) => a.email)).toEqual(['ana@x.com', 'beto@x.com']);
    const perms = resolveDraftPermissions({ state: s, actorEmail: 'ela@x.com', isElaborator: true });
    expect(perms).toMatchObject({ canUpload: true, canSubmitInternal: false, canMark: true, canViewBoard: true });
    expect(applyDraftNewVersion(s, { actor: elaborador, version: version('b') }).versionLabel).toBe('v0.2');
  });

  it('los validadores no suben archivos: marcan en el tablero', () => {
    const perms = resolveDraftPermissions({ state: enValidacion(), actorEmail: 'ana@x.com', isElaborator: false });
    expect(perms).toMatchObject({ canUpload: false, canMark: true, canDecideInternal: true, canViewBoard: true });
    const ajeno = resolveDraftPermissions({ state: enValidacion(), actorEmail: 'otro@x.com', isElaborator: false });
    expect(ajeno.canViewBoard).toBe(false);
    // Reconocido por su usuario aunque la sesión traiga otro correo: ve la hoja y puede subrayar.
    const porUsuario = resolveDraftPermissions({
      state: enValidacion(),
      actorEmail: 'ana.alias@x.com',
      actorUserId: 'u-ana',
      isElaborator: false,
    });
    expect(porUsuario).toMatchObject({ canViewBoard: true, canMark: true, canDecideInternal: true });
  });

  it('aprueban al mismo tiempo, en cualquier orden; con todos queda validado', () => {
    const uno = applyDraftInternalDecision(enValidacion(), { actor: beto, decision: 'approve' });
    expect(uno.status).toBe('EN_VALIDACION_INTERNA');
    expect(uno.internalReview?.approvals.find((a) => a.email === 'beto@x.com')?.approvedVersion).toBe('v0.1');
    expect(() => applyDraftInternalDecision(uno, { actor: beto, decision: 'approve' })).toThrow(/Ya aprobó/);
    const dos = applyDraftInternalDecision(uno, { actor: ana, decision: 'approve' });
    expect(dos.status).toBe('VALIDADO_INTERNO');
    expect(dos.internalReview?.status).toBe('APROBADO');
  });

  it('no se aprueba una subversión ya reemplazada; la nueva pide aprobar otra vez', () => {
    const aprobado = applyDraftInternalDecision(enValidacion(), { actor: ana, decision: 'approve', baseVersion: 'v0.1' });
    const v2 = applyDraftNewVersion(aprobado, { actor: elaborador, version: version('b') });
    expect(v2.versionLabel).toBe('v0.2');
    expect(() => applyDraftInternalDecision(v2, { actor: beto, decision: 'approve', baseVersion: 'v0.1' })).toThrow(
      /se subió la v0\.2/
    );
    const anaV2 = v2.internalReview?.approvals.find((a) => a.email === 'ana@x.com');
    expect(anaV2).toMatchObject({ decision: 'PENDIENTE', approvedVersion: 'v0.1' });
    expect(pendingDraftValidators(v2)).toHaveLength(2);
  });

  it('pedir corrección exige comentario y solo cambia el estado de ese validador', () => {
    expect(() => applyDraftInternalDecision(enValidacion(), { actor: ana, decision: 'return' })).toThrow(
      /qué debe corregirse/
    );
    const pedido = applyDraftInternalDecision(enValidacion(), {
      actor: ana,
      decision: 'return',
      comment: 'Cláusula 3 incompleta',
    });
    expect(pedido.status).toBe('EN_VALIDACION_INTERNA');
    expect(draftCorrectionRequests(pedido).map((a) => [a.email, a.comment, a.correctionVersion])).toEqual([
      ['ana@x.com', 'Cláusula 3 incompleta', 'v0.1'],
    ]);
    // Beto sigue revisando y puede aprobar; Ana no puede aprobar hasta que corrijan.
    const betoAprueba = applyDraftInternalDecision(pedido, { actor: beto, decision: 'approve' });
    expect(betoAprueba.status).toBe('EN_VALIDACION_INTERNA');
    expect(() => applyDraftInternalDecision(betoAprueba, { actor: ana, decision: 'approve' })).toThrow(/Ya pidió corrección/);
  });

  it('al subir la corrección, el pedido marcado vuelve a revisión y todos aprueban otra vez', () => {
    let s = applyDraftInternalDecision(enValidacion(), { actor: ana, decision: 'return', comment: 'Cambiar fecha' });
    s = applyDraftInternalDecision(s, { actor: beto, decision: 'approve' });
    const v2 = applyDraftNewVersion(s, { actor: elaborador, version: version('f'), resolvedEmails: ['ana@x.com'] });
    expect(v2.internalReview?.approvals.map((a) => [a.email, a.decision, a.correctedIn ?? null])).toEqual([
      ['ana@x.com', 'PENDIENTE', 'v0.2'],
      ['beto@x.com', 'PENDIENTE', null],
    ]);
    let fin = applyDraftInternalDecision(v2, { actor: ana, decision: 'approve' });
    fin = applyDraftInternalDecision(fin, { actor: beto, decision: 'approve' });
    expect(fin.status).toBe('VALIDADO_INTERNO');
  });

  it('un pedido que no se marca como corregido sigue esperando', () => {
    const s = applyDraftInternalDecision(enValidacion(), { actor: ana, decision: 'return', comment: 'Anexo B' });
    const v2 = applyDraftNewVersion(s, { actor: elaborador, version: version('g'), resolvedEmails: [] });
    expect(draftCorrectionRequests(v2).map((a) => a.email)).toEqual(['ana@x.com']);
  });
});

describe('preparación Word: editar validadores', () => {
  const caro: OrionReviewValidator = { userId: 'u-caro', email: 'caro@x.com', name: 'Caro', order: 3 };
  function enValidacion() {
    return applyDraftSubmitInternal(nuevo(), { actor: elaborador, validators });
  }

  it('agrega uno nuevo: queda pendiente y los demás conservan su decisión', () => {
    const anaAprobo = applyDraftInternalDecision(enValidacion(), { actor: ana, decision: 'approve' });
    const { state, added, removed } = applyDraftEditValidators(anaAprobo, { validators: [...validators, caro] });
    expect(added.map((a) => a.email)).toEqual(['caro@x.com']);
    expect(removed).toEqual([]);
    expect(state.internalReview?.approvals.map((a) => [a.email, a.decision])).toEqual([
      ['ana@x.com', 'APROBADO'],
      ['beto@x.com', 'PENDIENTE'],
      ['caro@x.com', 'PENDIENTE'],
    ]);
  });

  it('quitar al único pendiente deja el documento validado', () => {
    const anaAprobo = applyDraftInternalDecision(enValidacion(), { actor: ana, decision: 'approve' });
    const { state, removed } = applyDraftEditValidators(anaAprobo, { validators: [validators[0]] });
    expect(removed.map((a) => a.email)).toEqual(['beto@x.com']);
    expect(state.status).toBe('VALIDADO_INTERNO');
  });

  it('no se puede dejar sin validadores ni editar fuera de la validación', () => {
    expect(() => applyDraftEditValidators(enValidacion(), { validators: [] })).toThrow(/al menos un validador/);
    expect(() => applyDraftEditValidators(nuevo(), { validators })).toThrow(/validación interna/);
  });
});

describe('preparación Word: persistencia en el bag', () => {
  it('drafts sobrevive a parse/serialize junto a documents', () => {
    const raw = serializeOrionSignatureBagBag({
      documents: { p1: { fileId: 'p1', status: 'BORRADOR' } },
      drafts: { f1: nuevo() },
    });
    const bag = parseOrionSignatureBagBag(raw);
    expect(bag.documents.p1?.status).toBe('BORRADOR');
    expect(bag.drafts?.f1?.status).toBe('EN_ELABORACION');
    expect(bag.drafts?.f1?.versions).toHaveLength(1);
  });

  it('un bag sin drafts no agrega la llave', () => {
    const raw = serializeOrionSignatureBagBag({ documents: {} });
    expect(JSON.parse(raw)).not.toHaveProperty('drafts');
  });
});

describe('preparación Word: revisión del cliente', () => {
  const clientes = [
    { email: 'Cli1@cliente.com', name: 'Cliente Uno', cardCode: 'C1' },
    { email: 'cli2@cliente.com', name: 'Cliente Dos', cardCode: 'C2' },
  ];

  function validado() {
    let s = applyDraftSubmitInternal(nuevo(), { actor: elaborador, validators });
    s = applyDraftInternalDecision(s, { actor: ana, decision: 'approve' });
    return applyDraftInternalDecision(s, { actor: beto, decision: 'approve' });
  }

  function enviado(mode: 'sequential' | 'parallel') {
    return applyDraftSendClient(validado(), {
      actor: elaborador,
      reviewers: clientes,
      mode,
      orionDocumentId: 'orion-draft-1',
    });
  }

  it('solo se envía al cliente lo validado internamente', () => {
    expect(() =>
      applyDraftSendClient(nuevo(), { actor: elaborador, reviewers: clientes, mode: 'sequential', orionDocumentId: 'x' })
    ).toThrow(/validado internamente/);
    const perms = resolveDraftPermissions({ state: validado(), actorEmail: 'ela@x.com', isElaborator: true });
    expect(perms.canSendClient).toBe(true);
    expect(perms.canUpload).toBe(false);
  });

  it('en orden: solo el primero tiene enlace; en paralelo todos', () => {
    expect(activeClientReviewers(enviado('sequential').clientReview).map((r) => r.email)).toEqual([
      'cli1@cliente.com',
    ]);
    expect(activeClientReviewers(enviado('parallel').clientReview)).toHaveLength(2);
  });

  it('en orden: al aceptar el primero sigue el segundo; con todos queda aprobado', () => {
    const uno = applyDraftClientDecision(enviado('sequential'), { email: 'cli1@cliente.com', decision: 'ACEPTADO' });
    expect(uno.state.status).toBe('EN_REVISION_CLIENTE');
    expect(uno.nextReviewer?.email).toBe('cli2@cliente.com');
    const dos = applyDraftClientDecision(uno.state, { email: 'cli2@cliente.com', decision: 'ACEPTADO' });
    expect(dos.state.status).toBe('APROBADO_CLIENTE');
    expect(dos.nextReviewer).toBeNull();
    const perms = resolveDraftPermissions({ state: dos.state, actorEmail: 'ela@x.com', isElaborator: true });
    expect(perms).toMatchObject({ canConvertPdf: true, canUpload: true });
  });

  it('un rechazo cierra la ronda y anula los enlaces pendientes', () => {
    let s = enviado('parallel');
    s = applyDraftReviewerInvite(s, 'cli1@cliente.com', { reviewUrl: 'https://o/review/1' });
    s = applyDraftReviewerInvite(s, 'cli2@cliente.com', { reviewUrl: 'https://o/review/2' });
    const r = applyDraftClientDecision(s, {
      email: 'cli1@cliente.com',
      decision: 'RECHAZADO',
      comment: 'Falta la cláusula de confidencialidad',
    });
    expect(r.state.status).toBe('RECHAZADO_CLIENTE');
    expect(r.revokedEmails).toEqual(['cli2@cliente.com']);
    expect(r.state.clientReview?.reviewers.map((x) => x.decision)).toEqual(['RECHAZADO', 'ANULADO']);
    expect(r.state.clientReview?.reviewers[0]?.comment).toBe('Falta la cláusula de confidencialidad');
  });

  it('webhook repetido o tardío no cambia nada', () => {
    const r = applyDraftClientDecision(enviado('parallel'), { email: 'cli1@cliente.com', decision: 'RECHAZADO' });
    const again = applyDraftClientDecision(r.state, { email: 'cli2@cliente.com', decision: 'ACEPTADO' });
    expect(again.changed).toBe(false);
    expect(applyDraftClientDecision(r.state, { email: 'otro@x.com', decision: 'ACEPTADO' }).changed).toBe(false);
  });

  it('tras el rechazo se corrige, se revalida y se reenvía como ronda nueva', () => {
    const rechazado = applyDraftClientDecision(enviado('sequential'), {
      email: 'cli1@cliente.com',
      decision: 'RECHAZADO',
      comment: 'Cambiar fechas',
    }).state;
    const corregido = applyDraftNewVersion(rechazado, {
      actor: elaborador,
      version: version('z'),
    });
    let s = applyDraftSubmitInternal(corregido, { actor: elaborador, validators });
    s = applyDraftInternalDecision(s, { actor: ana, decision: 'approve' });
    s = applyDraftInternalDecision(s, { actor: beto, decision: 'approve' });
    const ronda2 = applyDraftSendClient(s, {
      actor: elaborador,
      reviewers: clientes,
      mode: 'sequential',
      orionDocumentId: 'orion-draft-2',
    });
    expect(ronda2.clientReview?.round).toBe(2);
    expect(ronda2.clientReview?.versionLabel).toBe('v0.2');
    expect(ronda2.clientReviewHistory?.[0]?.orionDocumentId).toBe('orion-draft-1');
  });

  it('convertir a PDF solo con aprobación del cliente', () => {
    const pdfVersion = { ...version('pdf'), fileName: 'Contrato.pdf' };
    expect(() => applyDraftConverted(validado(), { pdfFileId: 'p1', version: pdfVersion })).toThrow(/aprobado por el cliente/);
    const aprobado = applyDraftClientDecision(enviado('parallel'), { email: 'cli1@cliente.com', decision: 'ACEPTADO' });
    const todos = applyDraftClientDecision(aprobado.state, { email: 'cli2@cliente.com', decision: 'ACEPTADO' });
    const convertido = applyDraftConverted(todos.state, { pdfFileId: 'p1', version: pdfVersion });
    expect(convertido.status).toBe('CONVERTIDO_PDF');
    expect(convertido.pdfFileId).toBe('p1');
    expect(convertido.versions.at(-1)).toMatchObject({ label: 'v1.0', kind: 'pdf' });
  });
});
