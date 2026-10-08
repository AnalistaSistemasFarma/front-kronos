import { describe, expect, it } from 'vitest';
import {
  activeClientReviewers,
  applyDraftClientDecision,
  applyDraftConverted,
  applyDraftEditValidators,
  applyDraftInternalDecision,
  applyDraftNewVersion,
  applyDraftResendInternal,
  applyDraftReviewerInvite,
  applyDraftSendClient,
  applyDraftSubmitInternal,
  createDraftState,
  draftCorrectionRequests,
  draftReviewPhase,
  findDraftForOneDriveItem,
  pendingDraftValidators,
  pdfReviewFromDraft,
  isWordDraftFileName,
  nextDraftVersionLabel,
  redactDraftForOutsider,
  resolveDraftPermissions,
  type DraftActor,
} from '../draftState';
import {
  parseOrionSignatureBagBag,
  serializeOrionSignatureBagBag,
} from '../formValue';
import { resetReviewForNewVersion, type OrionReviewValidator } from '../reviewState';

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

  it('quien no es preparadora ni validadora no ve el tablero ni sube (ni siendo admin)', () => {
    const perms = resolveDraftPermissions({ state: nuevo(), actorEmail: 'otro@x.com', isElaborator: false });
    expect(perms).toMatchObject({ canViewBoard: false, canUpload: false, canSubmitInternal: false });
    expect(resolveDraftPermissions({ state: nuevo(), actorEmail: 'otro@x.com', isElaborator: false, isAdmin: true }).canViewBoard).toBe(false);
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

  it('en validación la preparadora no sube la versión corregida hasta que respondan todos', () => {
    const s = enValidacion();
    expect(s.status).toBe('EN_VALIDACION_INTERNA');
    expect(pendingDraftValidators(s).map((a) => a.email)).toEqual(['ana@x.com', 'beto@x.com']);
    const perms = resolveDraftPermissions({ state: s, actorEmail: 'ela@x.com', isElaborator: true });
    // La preparadora no comenta su propio documento: solo responde las marcas.
    expect(perms).toMatchObject({ canUpload: false, canSubmitInternal: false, canMark: false, canViewBoard: true });
    expect(() => applyDraftNewVersion(s, { actor: elaborador, version: version('b') })).toThrow(/Falta: Ana, Beto/);

    let respondieron = applyDraftInternalDecision(s, { actor: ana, decision: 'return', comment: 'Cambiar fecha' });
    expect(resolveDraftPermissions({ state: respondieron, actorEmail: 'ela@x.com', isElaborator: true }).canUpload).toBe(false);
    respondieron = applyDraftInternalDecision(respondieron, { actor: beto, decision: 'approve' });
    expect(resolveDraftPermissions({ state: respondieron, actorEmail: 'ela@x.com', isElaborator: true }).canUpload).toBe(true);
    expect(applyDraftNewVersion(respondieron, { actor: elaborador, version: version('b') }).versionLabel).toBe('v0.2');
  });

  it('un validador nunca sube, aunque además tenga permiso de preparar', () => {
    let s = applyDraftInternalDecision(enValidacion(), { actor: ana, decision: 'return', comment: 'Anexo' });
    s = applyDraftInternalDecision(s, { actor: beto, decision: 'approve' });
    const perms = resolveDraftPermissions({ state: s, actorEmail: 'ana@x.com', isElaborator: true });
    expect(perms).toMatchObject({ canUpload: false, canSubmitInternal: false, canConvertPdf: false, canViewBoard: true });
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

  it('no se aprueba una versión ya reemplazada; al enviar la corrección todos validan otra vez', () => {
    const aprobado = applyDraftInternalDecision(enValidacion(), { actor: ana, decision: 'approve', baseVersion: 'v0.1' });
    const respondieron = applyDraftInternalDecision(aprobado, { actor: beto, decision: 'return', comment: 'Fecha' });
    const v2 = applyDraftNewVersion(respondieron, { actor: elaborador, version: version('b') });
    const enviada = applyDraftResendInternal(v2, { actor: elaborador });
    expect(enviada.versionLabel).toBe('v0.2');
    expect(() => applyDraftInternalDecision(enviada, { actor: beto, decision: 'approve', baseVersion: 'v0.1' })).toThrow(
      /se subió la v0\.2/
    );
    const anaV2 = enviada.internalReview?.approvals.find((a) => a.email === 'ana@x.com');
    expect(anaV2).toMatchObject({ decision: 'PENDIENTE', approvedVersion: 'v0.1' });
    expect(pendingDraftValidators(enviada)).toHaveLength(2);
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

  it('orden de la corrección: primero sube, luego marca lo corregido y envía; todos validan otra vez', () => {
    let s = applyDraftInternalDecision(enValidacion(), { actor: ana, decision: 'return', comment: 'Cambiar fecha' });
    s = applyDraftInternalDecision(s, { actor: beto, decision: 'approve' });
    expect(draftReviewPhase(s)).toBe('correccion');

    // Antes de subir: puede subir, pero todavía no marca "Ya la corregí" ni envía.
    const antes = resolveDraftPermissions({ state: s, actorEmail: 'ela@x.com', isElaborator: true });
    expect(antes).toMatchObject({ canUpload: true, canMarkFixed: false, canResendInternal: false });
    expect(() => applyDraftResendInternal(s, { actor: elaborador })).toThrow(/Primero suba la versión corregida/);

    // Sube (puede subir varias): los validadores no se enteran todavía.
    const v2 = applyDraftNewVersion(s, { actor: elaborador, version: version('f') });
    const v3 = applyDraftNewVersion(v2, { actor: elaborador, version: version('g'), baseVersion: 'v0.2' });
    expect(v3.internalReview?.versionLabel).toBe('v0.1');
    expect(draftCorrectionRequests(v3).map((a) => a.email)).toEqual(['ana@x.com']);
    expect(pendingDraftValidators(v3)).toEqual([]);
    const despues = resolveDraftPermissions({ state: v3, actorEmail: 'ela@x.com', isElaborator: true });
    expect(despues).toMatchObject({ canMarkFixed: true, canResendInternal: true });

    // Envía: todos vuelven a validar la versión nueva; Ana la ve como "corregido en v0.3".
    const enviada = applyDraftResendInternal(v3, { actor: elaborador, baseVersion: 'v0.3' });
    expect(draftReviewPhase(enviada)).toBe('revision');
    expect(enviada.internalReview?.versionLabel).toBe('v0.3');
    expect(enviada.internalReview?.round).toBe(2);
    expect(enviada.internalReview?.approvals.map((a) => [a.email, a.decision, a.correctedIn ?? null])).toEqual([
      ['ana@x.com', 'PENDIENTE', 'v0.3'],
      ['beto@x.com', 'PENDIENTE', null],
    ]);
    let fin = applyDraftInternalDecision(enviada, { actor: ana, decision: 'approve' });
    fin = applyDraftInternalDecision(fin, { actor: beto, decision: 'approve' });
    expect(fin.status).toBe('VALIDADO_INTERNO');
  });

  it('si todos aprueban no hay fase de corrección ni hace falta subir otra versión', () => {
    let s = applyDraftInternalDecision(enValidacion(), { actor: ana, decision: 'approve' });
    expect(draftReviewPhase(s)).toBe('revision');
    s = applyDraftInternalDecision(s, { actor: beto, decision: 'approve' });
    expect(s.status).toBe('VALIDADO_INTERNO');
    expect(draftReviewPhase(s)).toBeNull();
  });

  it('en corrección los validadores ya no marcan: el turno es de la preparadora', () => {
    let s = applyDraftInternalDecision(enValidacion(), { actor: ana, decision: 'return', comment: 'Anexo B' });
    expect(resolveDraftPermissions({ state: s, actorEmail: 'beto@x.com', isElaborator: false }).canMark).toBe(true);
    s = applyDraftInternalDecision(s, { actor: beto, decision: 'approve' });
    expect(resolveDraftPermissions({ state: s, actorEmail: 'ana@x.com', isElaborator: false }).canMark).toBe(false);
  });
});

describe('una sola validación: el PDF hereda la del Word', () => {
  function validado() {
    let s = applyDraftSubmitInternal(nuevo(), { actor: elaborador, validators });
    s = applyDraftInternalDecision(s, { actor: ana, decision: 'approve' });
    return applyDraftInternalDecision(s, { actor: beto, decision: 'approve' });
  }

  it('el PDF nace aprobado con los validadores del Word (para ubicar sus vistos buenos)', () => {
    const review = pdfReviewFromDraft(validado());
    expect(review).toMatchObject({ status: 'APROBADO', source: 'word', sourceVersionLabel: 'v0.1' });
    expect(review?.approvals.map((a) => [a.email, a.decision])).toEqual([
      ['ana@x.com', 'APROBADO'],
      ['beto@x.com', 'APROBADO'],
    ]);
  });

  it('sin la validación del Word completa, el PDF no hereda nada', () => {
    expect(pdfReviewFromDraft(nuevo())).toBeNull();
    const aMedias = applyDraftInternalDecision(applyDraftSubmitInternal(nuevo(), { actor: elaborador, validators }), {
      actor: ana,
      decision: 'approve',
    });
    expect(pdfReviewFromDraft(aMedias)).toBeNull();
  });

  it('una versión corregida del PDF conserva la aprobación del Word; un PDF directo se reinicia', () => {
    const heredada = pdfReviewFromDraft(validado())!;
    expect(resetReviewForNewVersion(heredada, 'v1.1')).toMatchObject({ status: 'APROBADO', versionLabel: 'v1.1' });
    const directa = { ...heredada, source: null };
    expect(resetReviewForNewVersion(directa, 'v1.1')?.status).toBe('SIN_VALIDACION');
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

  it('convertir a PDF: validado (sin cliente) o aprobado por el cliente', () => {
    const pdfVersion = { ...version('pdf'), fileName: 'Contrato.pdf' };
    expect(() => applyDraftConverted(nuevo(), { pdfFileId: 'p1', version: pdfVersion })).toThrow(/validado/);
    expect(applyDraftConverted(validado(), { pdfFileId: 'p0', version: pdfVersion }).status).toBe('CONVERTIDO_PDF');
    expect(resolveDraftPermissions({ state: validado(), actorEmail: 'ela@x.com', isElaborator: true }).canConvertPdf).toBe(true);
    const aprobado = applyDraftClientDecision(enviado('parallel'), { email: 'cli1@cliente.com', decision: 'ACEPTADO' });
    const todos = applyDraftClientDecision(aprobado.state, { email: 'cli2@cliente.com', decision: 'ACEPTADO' });
    const convertido = applyDraftConverted(todos.state, { pdfFileId: 'p1', version: pdfVersion });
    expect(convertido.status).toBe('CONVERTIDO_PDF');
    expect(convertido.pdfFileId).toBe('p1');
    expect(convertido.versions.at(-1)).toMatchObject({ label: 'v1.0', kind: 'pdf' });
  });
});

describe('preparación Word: acceso de quien no participa', () => {
  it('reconoce el Word de trabajo y las copias de versión del borrador', () => {
    const s = applyDraftNewVersion(nuevo(), { actor: elaborador, version: version('b') });
    const drafts = { f1: s };
    expect(findDraftForOneDriveItem(drafts, ['f1'])?.fileId).toBe('f1');
    expect(findDraftForOneDriveItem(drafts, ['item-a'])?.fileId).toBe('f1');
    expect(findDraftForOneDriveItem(drafts, ['otro', 'item-b'])?.fileId).toBe('f1');
    expect(findDraftForOneDriveItem(drafts, ['ajeno'])).toBeNull();
    expect(findDraftForOneDriveItem(undefined, ['f1'])).toBeNull();
    expect(findDraftForOneDriveItem(drafts, ['', null])).toBeNull();
  });

  it('a quien no participa no le llegan versiones, comentarios ni correos', () => {
    const devuelto = applyDraftInternalDecision(
      applyDraftSubmitInternal(nuevo(), { actor: elaborador, validators }),
      { actor: ana, decision: 'return', comment: 'Cambiar fecha' }
    );
    const r = redactDraftForOutsider(devuelto);
    expect(r).toMatchObject({ fileId: 'f1', status: devuelto.status, versionLabel: devuelto.versionLabel });
    expect(r.versions).toEqual([]);
    expect(r.createdByEmail).toBe('');
    expect(r.internalReview?.returnReason).toBeUndefined();
    expect(r.internalReview?.approvals.map((a) => [a.name, a.decision])).toEqual([
      ['Ana', 'DEVUELTO'],
      ['Beto', 'PENDIENTE'],
    ]);
    const json = JSON.stringify(r);
    expect(json).not.toContain('item-a');
    expect(json).not.toContain('Cambiar fecha');
    expect(json).not.toContain('@x.com');
  });
});
