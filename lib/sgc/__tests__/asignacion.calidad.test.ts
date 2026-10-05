import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 2026-10-05 (demo PiSA, pedido de Nicolás): quien hace la solicitud elige
 * revisores, aprobadores y divulgación con la misma pantalla, pero queda
 * SUGERIDO (is_active = 0, sin removed_at); quien ejecuta la primera tarea
 * (quien crea el documento) y/o Calidad, según SGC_ASIGNACION_PERMISO, lo
 * confirma con un clic o lo reasigna. Solo lo confirmado entra a las tareas.
 * Ni el solicitante ni el elaborador quedan como firmantes de lo suyo.
 */

const h = vi.hoisted(() => ({ def: null as unknown, pools: [] as string[] }));
vi.mock('../../notifications.js', () => ({ createAndSendNotifications: vi.fn() }));
vi.mock('../db/flows', async (orig) => ({
  ...(await orig<typeof import('../db/flows')>()),
  loadDefinition: vi.fn(async () => h.def),
  getCurrentFlowVersion: vi.fn(async () => ({ process: { id_flow_process: 1, name: 'Documental' }, version: { id_flow_version: 3, version_number: 3 } })),
}));
vi.mock('../db/authorizations', async (orig) => ({
  ...(await orig<typeof import('../db/authorizations')>()),
  getPoolTypeCodes: vi.fn(async () => h.pools),
  getPoolMembers: vi.fn(async () => []),
}));

import { normalizeFlowDefinition, type SgcFlowDefinition } from '../flows/definition';
import { SGC_AUTH_TYPE_QUALITY, SGC_DOCUMENT_FLOW_V3 } from '../flows/documentFlow';
import { normalizeSigners } from '../flows/engine';
import {
  SGC_DEFAULT_ASSIGNMENT_POLICY,
  canSuggestParticipants,
  isPendingSuggestion,
  assignmentDenial,
  assignmentGaps,
  canAssignParticipants,
  executesFirstTask,
  firstTaskPeopleOf,
  firstWorkTask,
  approvalStepsWithoutQualityPool,
  exclusiveRoleClash,
  poolSlotRoleDenial,
  parseAssignmentPolicy,
  sgcAssignmentPolicy,
  type SgcAssignerInput,
} from '../flows/assignment';
import { assertAssignmentComplete, confirmSuggestions, createRequest, decideTask, setSigners } from '../db/requests';
import { addScopeEntry, removeScopeEntry } from '../db/dissemination';
import type { SgcCompanyAccess } from '../permissions';

const V3 = normalizeFlowDefinition(SGC_DOCUMENT_FLOW_V3);
const SOL = 'solicitante@x.co';
const ELAB = 'juan.mora@x.co';
const CAL = 'otra.calidad@x.co';
const REV = 'revisora@x.co';
const APR = 'aprobadora@x.co';

const who = (email: string, isQuality: boolean, extra: Partial<SgcAssignerInput> = {}): SgcAssignerInput => ({
  email,
  isQuality,
  poolTypeCodes: [],
  requesterEmail: SOL,
  elaboratorEmail: ELAB,
  ...extra,
});

describe('SGC · selección de firmantes y alcance (reglas puras)', () => {
  it('la primera tarea de trabajo del flujo documental es la elaboración (quien crea el documento)', () => {
    expect(firstWorkTask(V3)?.key).toBe('elaboracion');
    expect(executesFirstTask(V3, who(ELAB, false))).toBe(true);
    expect(executesFirstTask(V3, who(CAL, true))).toBe(false);
  });

  it('el solicitante NUNCA confirma ni asigna en su propia solicitud (solo sugiere), aunque sea el elaborador y tenga el permiso de Calidad', () => {
    for (const policy of ['tarea', 'calidad', 'tarea_o_calidad', 'tarea_y_calidad'] as const) {
      expect(assignmentDenial(V3, who(SOL, true, { elaboratorEmail: SOL }), policy)).toMatch(/Quien hace la solicitud solo sugiere/);
      expect(canAssignParticipants(V3, who('SOLICITANTE@x.co', true), policy)).toBe(false);
    }
  });

  it('política por defecto (la más segura): quien ejecuta la primera tarea Y tiene el permiso de Calidad', () => {
    expect(SGC_DEFAULT_ASSIGNMENT_POLICY).toBe('tarea_y_calidad');
    expect(canAssignParticipants(V3, who(ELAB, true))).toBe(true);
    expect(assignmentDenial(V3, who(ELAB, false))).toMatch(/con el permiso de Aseguramiento de Calidad/);
    expect(canAssignParticipants(V3, who(CAL, true))).toBe(false);
    expect(canAssignParticipants(V3, who(REV, false))).toBe(false);
  });

  it('la política es parametrizable: tarea, calidad, tarea_o_calidad', () => {
    expect(canAssignParticipants(V3, who(ELAB, false), 'tarea')).toBe(true);
    expect(canAssignParticipants(V3, who(CAL, true), 'tarea')).toBe(false);
    expect(canAssignParticipants(V3, who(CAL, true), 'calidad')).toBe(true);
    expect(canAssignParticipants(V3, who(ELAB, false), 'calidad')).toBe(false);
    expect(canAssignParticipants(V3, who(CAL, true), 'tarea_o_calidad')).toBe(true);
    expect(canAssignParticipants(V3, who(ELAB, false), 'tarea_o_calidad')).toBe(true);
    expect(canAssignParticipants(V3, who(REV, false), 'tarea_o_calidad')).toBe(false);
    expect(parseAssignmentPolicy('TAREA_O_CALIDAD')).toBe('tarea_o_calidad');
    expect(parseAssignmentPolicy('cualquiera')).toBe('tarea_y_calidad');
    expect(parseAssignmentPolicy(undefined)).toBe('tarea_y_calidad');
  });

  it('si la primera tarea la atiende el grupo de Calidad, ejecutarla = pertenecer al grupo (o haberla tenido)', () => {
    const def: SgcFlowDefinition = {
      ...V3,
      tasks: [
        ...V3.tasks.map((t) => (t.stepOrder > 0 ? { ...t, stepOrder: t.stepOrder + 1 } : t)),
        { ...V3.tasks.find((t) => t.key === 'capacitacion')!, key: 'radicacion', name: 'Radicación de Calidad', stepOrder: 1, role: 'calidad', conditionKey: null, signatureMeaning: null },
      ],
    };
    expect(firstWorkTask(def)?.key).toBe('radicacion');
    expect(executesFirstTask(def, who(CAL, false, { poolTypeCodes: [SGC_AUTH_TYPE_QUALITY] }))).toBe(true);
    expect(executesFirstTask(def, who(CAL, false, { firstTaskPeople: ['OTRA.calidad@x.co'] }))).toBe(true);
    expect(executesFirstTask(def, who(ELAB, false))).toBe(false);
    expect(firstTaskPeopleOf(def, [{ task_key: 'radicacion', resolved_by: 'A@x.co', assignees: [{ user_email: null, decided_by: 'B@x.co' }, { user_email: 'C@x.co' }] }, { task_key: 'elaboracion', resolved_by: 'z@x.co' }]).sort()).toEqual(['a@x.co', 'b@x.co', 'c@x.co']);
    expect(firstTaskPeopleOf({ ...V3, tasks: [V3.tasks[0]] }, [])).toEqual([]);
  });

  it('ni el solicitante ni el elaborador quedan como revisores o aprobadores de lo suyo', () => {
    const eligible = new Set([SOL, ELAB, REV, APR]);
    const base = { stepName: 'Revisión', elaboratorEmail: ELAB, requesterEmail: SOL, eligibleEmails: eligible };
    expect(() => normalizeSigners([REV, SOL], base)).toThrow(/Quien hizo la solicitud no puede ser firmante/);
    expect(() => normalizeSigners([ELAB], base)).toThrow(/El elaborador no puede ser firmante/);
    expect(normalizeSigners([REV, APR], base)).toEqual([{ email: REV, order: 1 }, { email: APR, order: 2 }]);
  });

  it('la primera tarea no se completa sin firmantes; el alcance solo si se exige (SGC-REQ-053 da el departamento por defecto)', () => {
    expect(assignmentGaps(V3, new Map(), 0)).toEqual(['los firmantes de «Revisión»', 'los firmantes de «Aprobación»']);
    expect(assignmentGaps(V3, new Map([['revision', 1], ['aprobacion', 2]]), 0)).toEqual([]);
    expect(assignmentGaps(V3, new Map([['revision', 1], ['aprobacion', 2]]), 0, { requireScope: true })).toEqual(['el alcance de divulgación']);
    expect(assignmentGaps(V3, new Map([['revision', 1], ['aprobacion', 2]]), 1, { requireScope: true })).toEqual([]);
  });

  it('sugerido frente a confirmado sin migración: is_active = 0 y sin removed_at; sugieren el solicitante y el elaborador', () => {
    expect(isPendingSuggestion({ is_active: false, removed_at: null })).toBe(true);
    expect(isPendingSuggestion({ is_active: true, removed_at: null })).toBe(false);
    expect(isPendingSuggestion({ is_active: false, removed_at: new Date() })).toBe(false);
    expect(canSuggestParticipants(who(SOL, false))).toBe(true);
    expect(canSuggestParticipants(who(ELAB, false))).toBe(true);
    expect(canSuggestParticipants(who(REV, true))).toBe(false);
  });

  it('la política se lee de SGC_ASIGNACION_PERMISO', () => {
    vi.stubEnv('SGC_ASIGNACION_PERMISO', 'calidad');
    expect(sgcAssignmentPolicy()).toBe('calidad');
    vi.unstubAllEnvs();
    expect(sgcAssignmentPolicy()).toBe(SGC_DEFAULT_ASSIGNMENT_POLICY);
  });
});

// ---------------------------------------------------------------------------
// Capa de base de datos con una base simulada (el servidor es la autoridad)
// ---------------------------------------------------------------------------

type Call = { model: string; method: string; args: unknown };

function fakeDb(over: Record<string, Record<string, (args: unknown) => unknown>> = {}) {
  const calls: Call[] = [];
  const idRow = () => new Proxy({} as Record<string, unknown>, { get: (_, k) => (typeof k === 'string' && k.startsWith('id_') ? 1 : undefined) });
  const defaults: Record<string, () => unknown> = {
    findMany: () => [],
    groupBy: () => [],
    count: () => 0,
    findFirst: () => null,
    findUnique: () => null,
    create: idRow,
    update: () => ({}),
    updateMany: () => ({ count: 0 }),
    upsert: () => ({}),
  };
  const db: Record<string, unknown> = new Proxy({} as Record<string, unknown>, {
    get(_, model) {
      if (model === '$transaction') return (fn: (tx: unknown) => unknown) => fn(db);
      if (typeof model !== 'string' || model === 'then') return undefined;
      return new Proxy({}, {
        get(__, method) {
          return async (args: unknown) => {
            calls.push({ model, method: String(method), args });
            const f = over[model]?.[String(method)];
            return f ? f(args) : defaults[String(method)]?.();
          };
        },
      });
    },
  });
  return { db: db as never, calls, writes: (model: string) => calls.filter((c) => c.model === model && ['create', 'update', 'updateMany', 'upsert'].includes(c.method)) };
}

const access = (canQuality: boolean): SgcCompanyAccess => ({ idCompany: 1, companyName: 'PISA', canRead: true, canManage: true, canQuality, canAdminFlows: false });
const actor = (email: string) => ({ email, ip: '10.0.0.1', userAgent: 'vitest' });
const notifier = vi.fn(async () => undefined);
const requestRow = { id_request: 7, id_company: 1, id_flow_version: 3, status: 'abierta', subject: 'Procedimiento', requester_email: SOL, elaborator_email: ELAB, signing_modes_json: null, documentType: null, tasks: [] };
const eligibleRows = [SOL, ELAB, CAL, REV, APR].map((email) => ({ companyUser: { user: { email, name: email } } }));

function signersDb() {
  return fakeDb({
    sgcRequest: { findUniqueOrThrow: () => requestRow, findUnique: () => requestRow },
    subprocessUserCompany: { findMany: () => eligibleRows },
  });
}

describe('SGC · el solicitante solo SUGIERE; quien ejecuta la primera tarea y/o Calidad confirma o reasigna', () => {
  beforeEach(() => {
    h.def = V3;
    h.pools = [];
  });
  afterEach(() => vi.unstubAllEnvs());

  const created = (f: ReturnType<typeof fakeDb>, model: string) => f.calls.filter((c) => c.model === model && c.method === 'create').map((c) => (c.args as { data: Record<string, unknown> }).data);

  it('setSigners del solicitante (aunque tenga permiso de Calidad): queda SUGERIDO (is_active = 0), con historial y auditoría; no activa a nadie', async () => {
    const f = signersDb();
    expect(await setSigners(f.db, notifier, 7, { stepKey: 'revision', signers: [REV], mode: 'paralelo' }, actor(SOL), access(true))).toEqual({ changed: true, suggested: true });
    expect(created(f, 'sgcRequestSigner')).toEqual([expect.objectContaining({ user_email: REV, is_active: false, added_by: SOL })]);
    expect(created(f, 'sgcInteraction')[0]).toMatchObject({ kind: 'firmantes', body: expect.stringMatching(/^Sugirió los firmantes de «Revisión» \(SUGERIDO/) });
    expect(JSON.stringify(created(f, 'sgcAuditLog'))).toMatch(/sugerido/);
    expect(f.writes('sgcTaskAssignee')).toEqual([]);
  });

  it('el solicitante no se sugiere a sí mismo ni al elaborador como firmante', async () => {
    await expect(setSigners(signersDb().db, notifier, 7, { stepKey: 'revision', signers: [SOL] }, actor(SOL), access(true))).rejects.toThrow(/Quien hizo la solicitud no puede ser firmante/);
    await expect(setSigners(signersDb().db, notifier, 7, { stepKey: 'aprobacion', signers: [ELAB] }, actor(SOL), access(true))).rejects.toThrow(/El elaborador no puede ser firmante/);
  });

  it('una vez confirmados, el solicitante ya no los cambia (403)', async () => {
    const f = fakeDb({ sgcRequest: { findUniqueOrThrow: () => requestRow }, subprocessUserCompany: { findMany: () => eligibleRows }, sgcRequestSigner: { count: () => 1 } });
    await expect(setSigners(f.db, notifier, 7, { stepKey: 'revision', signers: [APR] }, actor(SOL), access(true))).rejects.toMatchObject({ status: 403, message: expect.stringMatching(/ya están confirmados/) });
    expect(f.writes('sgcRequestSigner')).toEqual([]);
  });

  it('quien no es solicitante, elaborador ni está habilitado no sugiere ni asigna (403); con tarea_o_calidad, Calidad sí asigna', async () => {
    await expect(setSigners(signersDb().db, notifier, 7, { stepKey: 'revision', signers: [APR] }, actor(REV), access(false))).rejects.toMatchObject({ status: 403 });
    await expect(setSigners(signersDb().db, notifier, 7, { stepKey: 'revision', signers: [REV] }, actor(CAL), access(true))).rejects.toMatchObject({ status: 403 });
    vi.stubEnv('SGC_ASIGNACION_PERMISO', 'tarea_o_calidad');
    const f = signersDb();
    expect(await setSigners(f.db, notifier, 7, { stepKey: 'revision', signers: [REV] }, actor(CAL), access(true))).toEqual({ changed: true });
    expect(created(f, 'sgcRequestSigner')[0]).toMatchObject({ user_email: REV, added_by: CAL });
    expect(created(f, 'sgcRequestSigner')[0].is_active).toBeUndefined();
  });

  it('reasignar: quien crea el documento (Calidad) define a otras personas; lo sugerido se retira con removed_at y queda en el historial', async () => {
    const pending = [{ id_request_signer: 50, user_email: APR, sign_order: 1, is_active: false, removed_at: null, added_by: SOL }];
    const f = fakeDb({
      sgcRequest: { findUniqueOrThrow: () => requestRow },
      subprocessUserCompany: { findMany: () => eligibleRows },
      sgcRequestSigner: { findMany: (a) => ((a as { where: { is_active?: boolean } }).where.is_active === false ? pending : []) },
    });
    expect(await setSigners(f.db, notifier, 7, { stepKey: 'revision', signers: [REV] }, actor(ELAB), access(true))).toEqual({ changed: true });
    const retire = f.calls.find((c) => c.model === 'sgcRequestSigner' && c.method === 'updateMany')!.args as { where: Record<string, unknown>; data: Record<string, unknown> };
    expect(retire.where).toMatchObject({ is_active: false, removed_at: null, step_key: 'revision' });
    expect(retire.data).toMatchObject({ removed_by: ELAB });
    expect(created(f, 'sgcRequestSigner')).toEqual([expect.objectContaining({ user_email: REV, added_by: ELAB })]);
    expect(created(f, 'sgcInteraction')[0].body).toMatch(/Reemplaza lo sugerido: aprobadora@x.co/);
  });

  it('quien crea el documento (Calidad) no puede poner al solicitante ni a sí mismo como firmante', async () => {
    await expect(setSigners(signersDb().db, notifier, 7, { stepKey: 'revision', signers: [REV, SOL] }, actor(ELAB), access(true))).rejects.toThrow(/Quien hizo la solicitud no puede ser firmante/);
    await expect(setSigners(signersDb().db, notifier, 7, { stepKey: 'aprobacion', signers: [ELAB] }, actor(ELAB), access(true))).rejects.toThrow(/El elaborador no puede ser firmante/);
  });

  describe('«Aprobar sugerencia» (un clic)', () => {
    const pendingRows = [
      { id_request_signer: 61, step_key: 'revision', user_email: REV, sign_order: 1, is_active: false, removed_at: null, added_by: SOL },
      { id_request_signer: 62, step_key: 'aprobacion', user_email: APR, sign_order: 1, is_active: false, removed_at: null, added_by: SOL },
    ];
    const scopeRows = [{ id_scope: 9, scope_key: 'departamento:10', is_active: false, removed_at: null, added_by: SOL, change_reason: 'Área usuaria' }];
    const confirmDb = (pending = pendingRows, scope = scopeRows) =>
      fakeDb({
        sgcRequest: { findUniqueOrThrow: () => requestRow },
        subprocessUserCompany: { findMany: () => eligibleRows },
        sgcRequestSigner: { findMany: (a) => ((a as { where: { is_active?: boolean } }).where.is_active === false ? pending : []) },
        sgcDisseminationScope: { findMany: () => scope },
      });

    it('el solicitante no confirma su propia sugerencia (403)', async () => {
      const f = confirmDb();
      await expect(confirmSuggestions(f.db, notifier, 7, actor(SOL), access(true))).rejects.toMatchObject({ status: 403 });
      expect(f.writes('sgcRequestSigner')).toEqual([]);
    });

    it('quien crea el documento (Calidad) confirma firmantes y alcance: pasan a is_active = 1, con historial y auditoría', async () => {
      const f = confirmDb();
      expect(await confirmSuggestions(f.db, notifier, 7, actor(ELAB), access(true))).toEqual({ confirmed: 2, confirmedScope: 1 });
      const upd = f.calls.filter((c) => c.model === 'sgcRequestSigner' && c.method === 'update').map((c) => c.args as { where: { id_request_signer: number }; data: { is_active: boolean } });
      expect(upd.map((u) => [u.where.id_request_signer, u.data.is_active])).toEqual([[61, true], [62, true]]);
      expect(f.calls.find((c) => c.model === 'sgcDisseminationScope' && c.method === 'update')!.args).toMatchObject({ where: { id_scope: 9 }, data: { is_active: true } });
      expect(created(f, 'sgcInteraction')[0].body).toMatch(/^Confirmó la sugerencia de firmantes y alcance/);
      expect(JSON.stringify(created(f, 'sgcAuditLog'))).toMatch(/confirmado/);
    });

    it('al confirmar se vuelve a validar la segregación: la misma persona sugerida en revisión y aprobación no se confirma (409)', async () => {
      const f = confirmDb([pendingRows[0], { ...pendingRows[1], user_email: REV }], []);
      await expect(confirmSuggestions(f.db, notifier, 7, actor(ELAB), access(true))).rejects.toThrow(/dos papeles/);
      expect(f.writes('sgcRequestSigner')).toEqual([]);
    });

    it('sin nada sugerido no hay qué confirmar (409)', async () => {
      await expect(confirmSuggestions(confirmDb([], []).db, notifier, 7, actor(ELAB), access(true))).rejects.toMatchObject({ status: 409 });
    });

    it('la primera tarea no se completa (no arranca la revisión) mientras haya algo SUGERIDO sin confirmar', async () => {
      const f = fakeDb({
        sgcRequestSigner: { groupBy: () => [{ step_key: 'revision', _count: { _all: 1 } }, { step_key: 'aprobacion', _count: { _all: 1 } }], count: () => 1 },
      });
      await expect(assertAssignmentComplete(f.db, requestRow as never, V3, 'Elaboración')).rejects.toThrow(/SUGERIDOS sin confirmar/);
    });
  });

  it('alcance: el solicitante lo sugiere (is_active = 0); no retira lo confirmado; durante la divulgación no sugiere', async () => {
    const f = signersDb();
    expect(await addScopeEntry(f.db, notifier, access(true), 7, { entry: { kind: 'empresa' }, reason: 'Toda la empresa' }, actor(SOL))).toMatchObject({ suggested: true });
    expect(created(f, 'sgcDisseminationScope')).toEqual([expect.objectContaining({ is_active: false, added_by: SOL })]);
    expect(created(f, 'sgcInteraction')[0].body).toMatch(/^Sugirió agregar al alcance/);
    const confirmed = fakeDb({ sgcRequest: { findUnique: () => requestRow }, sgcDisseminationScope: { findUnique: () => ({ id_scope: 3, id_request: 7, is_active: true, removed_at: null, scope_key: 'empresa' }) } });
    await expect(removeScopeEntry(confirmed.db, access(true), 7, 3, { reason: 'Retirar la entrada' }, actor(SOL))).rejects.toMatchObject({ status: 403 });
    const during = fakeDb({ sgcRequest: { findUnique: () => ({ ...requestRow, tasks: [{ status: 'abierta', id_task: 4, taskDef: { assignment: 'alcance' } }] }) } });
    await expect(addScopeEntry(during.db, notifier, access(true), 7, { entry: { kind: 'empresa' }, reason: 'Toda la empresa' }, actor(SOL))).rejects.toMatchObject({ status: 403 });
    const g = signersDb();
    expect(await addScopeEntry(g.db, notifier, access(true), 7, { entry: { kind: 'empresa' }, reason: 'Toda la empresa' }, actor(ELAB))).toMatchObject({ suggested: false });
    expect(created(g, 'sgcDisseminationScope')[0].is_active).toBe(true);
  });

  describe('createRequest', () => {
    const input = { idCompany: 1, requestType: 'nuevo', subject: 'Procedimiento nuevo', description: 'Justificación de la prueba.', idProcess: 5, idDocumentType: 6, formValues: { urgencia: 'Normal' } };
    const createDb = (qualityCount = 1) =>
      fakeDb({
        subprocessUserCompany: { findMany: () => eligibleRows, count: () => qualityCount },
        sgcProcessMap: { findFirst: () => ({ id_process_map: 5 }) },
        sgcDocumentType: { findFirst: () => ({ id_document_type: 6 }) },
      });

    it('quien solicita no puede nombrarse elaborador (sería quien confirma sus propios firmantes)', async () => {
      const f = createDb();
      await expect(createRequest(f.db, notifier, access(true), { ...input, elaboratorEmail: SOL }, actor(SOL))).rejects.toThrow(/Elija como elaborador a quien crea el documento/);
      await expect(createRequest(f.db, notifier, access(true), input, actor(SOL))).rejects.toThrow(/Elija como elaborador/);
      expect(f.writes('sgcRequest')).toEqual([]);
    });

    it('con la política por defecto, el elaborador debe tener el permiso de Calidad', async () => {
      await expect(createRequest(createDb(0).db, notifier, access(true), { ...input, elaboratorEmail: ELAB }, actor(SOL))).rejects.toThrow(/no tiene el permiso de Aseguramiento de Calidad/);
    });
  });
});

describe('SGC · papeles excluyentes y aprobador de Calidad (PIC/S 6.6.4, 21 CFR 211.22)', () => {
  beforeEach(() => {
    h.def = V3;
    h.pools = [];
  });

  it('(1) reglas puras: revisor y aprobador se excluyen; el cupo de Calidad no lo toma quien ya tiene otro papel', () => {
    expect(exclusiveRoleClash([{ email: APR }], 'aprobacion', [{ email: APR, stepKey: 'revision' }])).toEqual({ email: APR, stepKey: 'revision' });
    expect(exclusiveRoleClash([{ email: 'REV@x.co' }], 'revision', [{ email: 'rev@x.co', stepKey: 'aprobacion' }])).toEqual({ email: 'REV@x.co', stepKey: 'aprobacion' });
    // Cambiar el MISMO paso (reordenar o reemplazar) no es un segundo papel.
    expect(exclusiveRoleClash([{ email: REV }], 'revision', [{ email: REV, stepKey: 'revision' }])).toBeNull();
    const ctx = { requesterEmail: SOL, elaboratorEmail: ELAB, signers: [{ email: REV, stepKey: 'revision' }, { email: APR, stepKey: 'aprobacion' }] };
    expect(poolSlotRoleDenial(SOL, 'aprobacion', ctx)).toMatch(/Quien hizo la solicitud no revisa ni aprueba/);
    expect(poolSlotRoleDenial(ELAB, 'aprobacion', ctx)).toMatch(/elaborador no puede revisar ni aprobar/);
    expect(poolSlotRoleDenial(REV, 'aprobacion', ctx)).toMatch(/otro papel/);
    expect(poolSlotRoleDenial(APR, 'aprobacion', ctx)).toBeNull();
    expect(poolSlotRoleDenial(CAL, 'aprobacion', ctx)).toBeNull();
  });

  it('(1) setSigners rechaza poner como aprobador a quien ya es revisor (y al revés), sin escribir nada', async () => {
    const f = fakeDb({
      sgcRequest: { findUniqueOrThrow: () => requestRow },
      subprocessUserCompany: { findMany: () => eligibleRows },
      sgcRequestSigner: {
        findMany: (args) => ((args as { where: { step_key?: unknown } }).where.step_key && typeof (args as { where: { step_key?: unknown } }).where.step_key === 'object' ? [{ user_email: REV, step_key: 'revision' }] : []),
      },
    });
    await expect(setSigners(f.db, notifier, 7, { stepKey: 'aprobacion', signers: [APR, REV] }, actor(ELAB), access(true))).rejects.toThrow(/ya es firmante de «Revisión»: una misma persona no puede tener dos papeles/);
    expect(f.writes('sgcRequestSigner')).toEqual([]);
  });

  it('(1) setSigners rechaza como revisor a quien ya tomó la verificación de Calidad de la aprobación', async () => {
    const f = fakeDb({
      sgcRequest: { findUniqueOrThrow: () => requestRow },
      subprocessUserCompany: { findMany: () => eligibleRows },
      sgcTaskAssignee: { findMany: () => [{ decided_by: CAL, task: { task_key: 'aprobacion' } }] },
    });
    await expect(setSigners(f.db, notifier, 7, { stepKey: 'revision', signers: [CAL] }, actor(ELAB), access(true))).rejects.toThrow(/ya es firmante de «Aprobación»/);
  });

  it('(1) un revisor no puede tomar el cupo del grupo de Calidad en la aprobación (403)', async () => {
    h.pools = [SGC_AUTH_TYPE_QUALITY];
    const taskRow = {
      id_task: 20,
      task_key: 'aprobacion',
      name: 'Aprobación',
      status: 'abierta',
      signing_mode: 'orden',
      assignees: [{ id_task_assignee: 31, user_email: null, pool_type_code: SGC_AUTH_TYPE_QUALITY, sign_order: 1, status: 'pendiente', signature_meaning: 'aprobo', signature_status: 'pendiente_s3' }],
      taskDef: { assignment: 'firmantes' },
    };
    const f = fakeDb({
      sgcTask: { findUnique: () => ({ id_request: 7 }), findUniqueOrThrow: () => taskRow },
      sgcRequest: { findUniqueOrThrow: () => requestRow },
      sgcRequestSigner: { findMany: () => [{ user_email: REV, step_key: 'revision' }, { user_email: APR, step_key: 'aprobacion' }] },
    });
    await expect(decideTask(f.db, notifier, 20, { decision: 'aprobar' }, actor(REV))).rejects.toMatchObject({ status: 403, message: expect.stringMatching(/otro papel/) });
    expect(f.writes('sgcTaskAssignee')).toEqual([]);
    expect(f.writes('sgcSignature')).toEqual([]);
  });

  it('(2) el flujo documental ya garantiza un aprobador de Calidad: la aprobación trae el cupo fijo del grupo SGC-VERIF-CALIDAD con firma «Aprobó»', () => {
    const apr = V3.tasks.find((t) => t.key === 'aprobacion')!;
    expect(apr).toMatchObject({ assignment: 'firmantes', signatureMeaning: 'aprobo', poolAuthorizationTypeCode: SGC_AUTH_TYPE_QUALITY, isEnabled: true });
    expect(approvalStepsWithoutQualityPool(V3)).toEqual([]);
  });

  it('(2) si un flujo quitara el cupo de Calidad, la primera tarea no se completa sin un aprobador con permiso de Calidad', async () => {
    const def: SgcFlowDefinition = { ...V3, tasks: V3.tasks.map((t) => (t.key === 'aprobacion' ? { ...t, poolAuthorizationTypeCode: null } : t)) };
    expect(approvalStepsWithoutQualityPool(def).map((t) => t.key)).toEqual(['aprobacion']);
    const withSigners = (qualityCount: number) =>
      fakeDb({
        sgcRequestSigner: { groupBy: () => [{ step_key: 'revision', _count: { _all: 1 } }, { step_key: 'aprobacion', _count: { _all: 1 } }], findMany: () => [{ user_email: APR }] },
        subprocessUserCompany: { count: () => qualityCount },
      });
    await expect(assertAssignmentComplete(withSigners(0).db, requestRow as never, def, 'Elaboración')).rejects.toThrow(/al menos un aprobador de Aseguramiento de Calidad/);
    await expect(assertAssignmentComplete(withSigners(1).db, requestRow as never, def, 'Elaboración')).resolves.toBeUndefined();
    await expect(assertAssignmentComplete(fakeDb().db, requestRow as never, V3, 'Elaboración')).rejects.toThrow(/falta seleccionar los firmantes de «Revisión» y los firmantes de «Aprobación»/);
  });
});
