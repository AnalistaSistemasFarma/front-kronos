import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Escenario completo de la preparación en Word con el código REAL de draftService: solo se
 * simulan la base de datos (bag de la solicitud, marcas, tareas), OneDrive y los avisos.
 * Valida el orden decidido el 2026-10-06: una sola validación (en Word), corrección por pasos
 * (subir → marcar → enviar), un aviso por validador y una tarea por persona y documento.
 */

const h = vi.hoisted(() => {
  type Mark = {
    id: number;
    requestId: number;
    fileId: string;
    number: number;
    type: 'correccion' | 'sugerencia' | 'pregunta';
    quote: string;
    suggest: string | null;
    why: string;
    createdVersion: string;
    anchorVersion: string;
    blockIndex: number;
    authorEmail: string;
    authorName: string | null;
    status: 'abierta' | 'corregida' | 'respondida' | 'confirmada';
    fixedIn: string | null;
    fixedQuote: string | null;
    autoDetected: boolean;
    replies: unknown[];
    createdAt: string;
  };
  return {
    bag: { documents: {}, drafts: {} } as Record<string, unknown>,
    marks: [] as Mark[],
    notifications: [] as Array<{ to: string[]; title: string }>,
    taskOpens: [] as Array<{ email: string; notify: boolean | undefined }>,
    taskCloses: [] as Array<{ userId: string | null | undefined; status: number }>,
    notes: [] as string[],
    uploads: 0,
  };
});

vi.mock('../service', () => ({
  loadOrionFormBagEnsured: vi.fn(async () => ({ field: { id_form_field: 1 }, bag: structuredClone(h.bag) })),
  loadOrionFormBag: vi.fn(async () => ({ field: { id_form_field: 1 }, bag: structuredClone(h.bag) })),
  upsertOrionFormBag: vi.fn(async (_pool: unknown, _req: number, _field: number, bag: Record<string, unknown>) => {
    h.bag = structuredClone(bag);
  }),
  assertUserIsOrionDocumentPreparer: vi.fn(async (_pool: unknown, p: { userId: string }) => {
    if (p.userId !== 'u-ela') throw Object.assign(new Error('Sin permiso de preparar'), { status: 403 });
    return { ctx: { id_requester: 'u-ela' } };
  }),
  isOrionRequestWorkflowLocked: vi.fn(async () => false),
  getRequestOrionContext: vi.fn(async () => ({ id_requester: 'u-ela', id_company: 1, subject_request: 'Contrato' })),
  insertRequestNote: vi.fn(async (_pool: unknown, p: { note?: string; text?: string }) => {
    h.notes.push(String(p.note ?? p.text ?? ''));
  }),
}));

vi.mock('../review', () => ({
  listRequestValidators: vi.fn(async () => [
    { userId: 'u-ana', email: 'ana@x.com', name: 'Ana', order: 1 },
    { userId: 'u-beto', email: 'beto@x.com', name: 'Beto', order: 2 },
  ]),
  openReviewTask: vi.fn(async (_pool: unknown, p: { review: { approvals: Array<{ email: string; decision: string; order: number }>; status: string }; notify?: boolean }) => {
    const pending = [...p.review.approvals].sort((a, b) => a.order - b.order).find((a) => a.decision === 'PENDIENTE');
    if (pending) h.taskOpens.push({ email: pending.email, notify: p.notify });
  }),
  closeReviewTasks: vi.fn(async (_pool: unknown, p: { onlyUserId?: string | null; status: number }) => {
    h.taskCloses.push({ userId: p.onlyUserId, status: p.status });
  }),
}));

vi.mock('../draftBoardDb', () => ({
  listDraftMarks: vi.fn(async () => h.marks.map((m) => ({ ...m }))),
  getDraftMark: vi.fn(async (_pool: unknown, id: number) => h.marks.find((m) => m.id === id) ?? null),
  insertDraftMark: vi.fn(async (_pool: unknown, p: { requestId: number; fileId: string; type: 'correccion'; quote: string; suggest: string | null; why: string; version: string; blockIndex: number; author: { email: string; name?: string | null } }) => {
    const id = h.marks.length + 1;
    h.marks.push({
      id,
      requestId: p.requestId,
      fileId: p.fileId,
      number: id,
      type: p.type,
      quote: p.quote,
      suggest: p.suggest,
      why: p.why,
      createdVersion: p.version,
      anchorVersion: p.version,
      blockIndex: p.blockIndex,
      authorEmail: p.author.email,
      authorName: p.author.name ?? null,
      status: 'abierta',
      fixedIn: null,
      fixedQuote: null,
      autoDetected: false,
      replies: [],
      createdAt: new Date().toISOString(),
    });
    return id;
  }),
  updateDraftMark: vi.fn(async (_pool: unknown, id: number, patch: Record<string, unknown>) => {
    const mark = h.marks.find((m) => m.id === id);
    if (mark) Object.assign(mark, patch);
  }),
  insertDraftMarkReply: vi.fn(async () => {}),
  insertDraftEvent: vi.fn(async () => {}),
  listDraftPresence: vi.fn(async () => []),
  touchDraftPresence: vi.fn(async () => {}),
  getCachedDraftBlocks: vi.fn(async () => [{ index: 0, text: 'La fecha de inicio es el 1 de enero.', lead: null }]),
  saveCachedDraftBlocks: vi.fn(async () => {}),
  getCachedDraftPdfItem: vi.fn(async () => null),
  saveCachedDraftPdfItem: vi.fn(async () => {}),
}));

vi.mock('../draftBlocks', () => ({
  docxToDraftBlocks: vi.fn(async () => [{ index: 0, text: 'La fecha de inicio es el 1 de febrero.', lead: null }]),
}));

vi.mock('../../onedrive/graphFolderUpload', () => ({
  getOneDriveItemMeta: vi.fn(async () => ({ name: 'Contrato.docx', parentName: 'Request-812', parentPath: '/SAPSEND/TEC/SG/Request-812' })),
  isOneDriveItemInFolder: vi.fn(() => true),
  listOneDriveFolderFiles: vi.fn(async () => []),
  ensureFolderAndUploadFile: vi.fn(async () => {
    h.uploads += 1;
    return { id: `item-${h.uploads}` };
  }),
  replaceOneDriveItemContent: vi.fn(async () => {}),
  downloadOneDriveItemContent: vi.fn(async () => ({ buffer: Buffer.from('PK-docx') })),
  convertOneDriveItemToPdf: vi.fn(async () => Buffer.from('%PDF-1.4')),
  listOneDriveFolderFileNames: vi.fn(async () => []),
  uniqueOneDriveFileName: vi.fn((name: string) => name),
}));

vi.mock('../../../components/microsoft-365/useGetMicrosoftToken', () => ({ useGetMicrosoftToken: vi.fn(async () => 'token') }));
vi.mock('../../notifications.js', () => ({
  createAndSendNotifications: vi.fn(async (to: string[], p: { title: string }) => {
    h.notifications.push({ to, title: p.title });
  }),
}));
vi.mock('../../notificationEvents.js', () => ({ buildAppUrl: (p: string) => `https://kronos${p}` }));
vi.mock('../docxClean', () => ({ inspectDocxMarkup: vi.fn(async () => ({ clean: true, comments: 0, trackedChanges: 0 })) }));
vi.mock('../client', () => ({}));
vi.mock('../inviteEmail', () => ({}));

import { createDraftState } from '../draftState';
import {
  convertOrionDraftToPdf,
  decideOrionDraftInternal,
  getOrionDraftInfo,
  orionDraftMarkAction,
  resendOrionDraftInternal,
  submitOrionDraftInternal,
  uploadOrionDraftVersion,
} from '../draftService';

const pool = {} as never;
const REQ = 812;
const FILE = 'f-word';
const ela = { userId: 'u-ela', email: 'ela@x.com', name: 'Ela' };
const ana = { userId: 'u-ana', email: 'ana@x.com', name: 'Ana' };
const beto = { userId: 'u-beto', email: 'beto@x.com', name: 'Beto' };
const DOCX = Buffer.concat([Buffer.from('PK'), Buffer.alloc(100)]);

const perms = async (actor: typeof ela) =>
  (await getOrionDraftInfo(pool, { requestId: REQ, fileId: FILE, actor, isAdmin: false })).permissions!;
const draft = () => (h.bag.drafts as Record<string, { status: string; versionLabel: string; internalReview: { versionLabel: string; round: number; approvals: Array<{ email: string; decision: string; correctedIn?: string | null }> } }>)[FILE];
const sentTo = (email: string) => h.notifications.filter((n) => n.to.includes(email));

beforeEach(() => {
  h.bag = {
    documents: {},
    drafts: {
      [FILE]: createDraftState({
        fileId: FILE,
        fileName: 'Contrato.docx',
        actor: ela,
        firstVersion: { id: 'v1', oneDriveItemId: 'item-0', fileName: 'Contrato.docx', uploadedByEmail: 'ela@x.com', createdAt: '2026-10-06T10:00:00Z' },
      }),
    },
  };
  h.marks = [];
  h.notifications = [];
  h.taskOpens = [];
  h.taskCloses = [];
  h.notes = [];
  h.uploads = 0;
});

describe('flujo completo de validación en Word (servicio real, BD simulada)', () => {
  it('validadores revisan → corrección ordenada → todos validan → PDF hereda la validación', async () => {
    // 1. La preparadora envía a validación: una tarea por validador.
    await submitOrionDraftInternal(pool, { requestId: REQ, fileId: FILE, actor: ela, validatorIds: ['u-ana', 'u-beto'] });
    expect(draft().status).toBe('EN_VALIDACION_INTERNA');
    expect(h.taskOpens.map((t) => t.email)).toEqual(['ana@x.com', 'beto@x.com']);

    // Ana marca una corrección con "Debe decir".
    await orionDraftMarkAction(pool, {
      requestId: REQ,
      fileId: FILE,
      actor: ana,
      isAdmin: false,
      input: { action: 'create', type: 'correccion', quote: '1 de enero', suggest: '1 de febrero', why: 'Fecha del contrato', blockIndex: 0 },
    });
    expect(h.marks).toHaveLength(1);

    // Mientras los validadores revisan, la preparadora no responde ni marca, ni sube.
    expect(await perms(ela)).toMatchObject({ canUpload: false, canMarkFixed: false, canResendInternal: false });
    await expect(
      orionDraftMarkAction(pool, { requestId: REQ, fileId: FILE, actor: ela, isAdmin: false, input: { action: 'mark-fixed', markId: 1 } })
    ).rejects.toThrow(/Primero suba la versión corregida/);

    // 2. Ana pide corrección; Beto aprueba → turno de la preparadora (un solo aviso "Le toca corregir").
    await decideOrionDraftInternal(pool, { requestId: REQ, fileId: FILE, actor: ana, decision: 'return', comment: 'Corregir la fecha' });
    expect(sentTo('ela@x.com').map((n) => n.title)).toEqual([
      'Ana le hizo una corrección: Contrato.docx',
      'Corrección pedida: Contrato.docx',
    ]);
    await decideOrionDraftInternal(pool, { requestId: REQ, fileId: FILE, actor: beto, decision: 'approve' });
    expect(sentTo('ela@x.com').at(-1)?.title).toBe('Le toca corregir: Contrato.docx');
    expect(h.taskCloses).toEqual([
      { userId: 'u-ana', status: 3 },
      { userId: 'u-beto', status: 2 },
    ]);

    // En corrección los validadores ya no marcan.
    expect((await perms(ana)).canMark).toBe(false);
    expect(await perms(ela)).toMatchObject({ canUpload: true, canMarkFixed: false, canResendInternal: false });
    await expect(resendOrionDraftInternal(pool, { requestId: REQ, fileId: FILE, actor: ela })).rejects.toThrow(
      /Primero suba la versión corregida/
    );

    // 3. Sube la versión corregida: los validadores NO reciben aviso ni tarea todavía.
    const before = h.notifications.length;
    const tasksBefore = h.taskOpens.length;
    await uploadOrionDraftVersion(pool, { requestId: REQ, fileId: FILE, actor: ela, content: DOCX, baseVersion: 'v0.1' });
    expect(draft().versionLabel).toBe('v0.2');
    expect(h.notifications.slice(before).filter((n) => n.to.includes('ana@x.com') || n.to.includes('beto@x.com'))).toEqual([]);
    expect(h.taskOpens.length).toBe(tasksBefore);
    // Kronos detectó solo que la fecha quedó corregida (la marca pasa a "corregida").
    expect(h.marks[0].status).toBe('corregida');

    // 4. Ya puede enviar; con una marca abierta no lo deja.
    expect(await perms(ela)).toMatchObject({ canMarkFixed: true, canResendInternal: true });
    h.marks[0].status = 'abierta';
    await expect(resendOrionDraftInternal(pool, { requestId: REQ, fileId: FILE, actor: ela })).rejects.toThrow(/Falta atender la marca 1/);
    await orionDraftMarkAction(pool, { requestId: REQ, fileId: FILE, actor: ela, isAdmin: false, input: { action: 'mark-fixed', markId: 1 } });
    expect(h.marks[0].status).toBe('corregida');

    // 5. Envía la corrección: UN aviso por validador y su misma tarea se reactiva (sin segundo aviso).
    const sentBefore = h.notifications.length;
    await resendOrionDraftInternal(pool, { requestId: REQ, fileId: FILE, actor: ela, baseVersion: 'v0.2' });
    const sent = h.notifications.slice(sentBefore);
    expect(sent.map((n) => [n.to, n.title])).toEqual([
      [['ana@x.com'], 'Nueva versión para validar: Contrato.docx'],
      [['beto@x.com'], 'Nueva versión para validar: Contrato.docx'],
    ]);
    expect(h.taskOpens.slice(-2)).toEqual([
      { email: 'ana@x.com', notify: false },
      { email: 'beto@x.com', notify: false },
    ]);
    expect(draft().internalReview.round).toBe(2);
    expect(draft().internalReview.approvals.map((a) => [a.email, a.decision, a.correctedIn ?? null])).toEqual([
      ['ana@x.com', 'PENDIENTE', 'v0.2'],
      ['beto@x.com', 'PENDIENTE', null],
    ]);

    // 6. Ana confirma su marca y ambos validan la versión nueva.
    await orionDraftMarkAction(pool, { requestId: REQ, fileId: FILE, actor: ana, isAdmin: false, input: { action: 'confirm', markId: 1 } });
    await decideOrionDraftInternal(pool, { requestId: REQ, fileId: FILE, actor: ana, decision: 'approve', baseVersion: 'v0.2' });
    await decideOrionDraftInternal(pool, { requestId: REQ, fileId: FILE, actor: beto, decision: 'approve', baseVersion: 'v0.2' });
    expect(draft().status).toBe('VALIDADO_INTERNO');

    // 7. Convertir a PDF: nace validado con los validadores del Word (sin otra validación).
    const { pdfFileId } = await convertOrionDraftToPdf(pool, { requestId: REQ, fileId: FILE, actor: ela });
    const pdf = (h.bag.documents as Record<string, { review: { status: string; source: string; sourceVersionLabel: string; approvals: Array<{ email: string; decision: string }> } }>)[pdfFileId];
    expect(pdf.review).toMatchObject({ status: 'APROBADO', source: 'word', sourceVersionLabel: 'v0.2' });
    expect(pdf.review.approvals.map((a) => [a.email, a.decision])).toEqual([
      ['ana@x.com', 'APROBADO'],
      ['beto@x.com', 'APROBADO'],
    ]);
  });

  it('un validador nunca sube ni envía la corrección', async () => {
    await submitOrionDraftInternal(pool, { requestId: REQ, fileId: FILE, actor: ela, validatorIds: ['u-ana', 'u-beto'] });
    await decideOrionDraftInternal(pool, { requestId: REQ, fileId: FILE, actor: ana, decision: 'return', comment: 'Anexo' });
    await decideOrionDraftInternal(pool, { requestId: REQ, fileId: FILE, actor: beto, decision: 'approve' });
    await expect(
      uploadOrionDraftVersion(pool, { requestId: REQ, fileId: FILE, actor: ana, content: DOCX })
    ).rejects.toThrow();
    await expect(resendOrionDraftInternal(pool, { requestId: REQ, fileId: FILE, actor: ana })).rejects.toThrow();
  });

  it('si todos aprueban de una vez, queda validado sin pedir otra versión', async () => {
    await submitOrionDraftInternal(pool, { requestId: REQ, fileId: FILE, actor: ela, validatorIds: ['u-ana', 'u-beto'] });
    await decideOrionDraftInternal(pool, { requestId: REQ, fileId: FILE, actor: ana, decision: 'approve' });
    await decideOrionDraftInternal(pool, { requestId: REQ, fileId: FILE, actor: beto, decision: 'approve' });
    expect(draft().status).toBe('VALIDADO_INTERNO');
    expect(sentTo('ela@x.com').at(-1)?.title).toBe('Validado internamente: Contrato.docx');
    expect(await perms(ela)).toMatchObject({ canUpload: false, canConvertPdf: true });
  });
});
