import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 2026-10-05 (demo PiSA, pedido de Nicolás): quien hace la solicitud solo
 * PROPONE (texto libre, nota del historial) y nunca selecciona revisores,
 * aprobadores ni divulgación; los selecciona quien ejecuta la primera tarea
 * (quien crea el documento) y/o Calidad, según SGC_ASIGNACION_PERMISO.
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
  SGC_PROPOSAL_NOTE_PREFIX,
  assignmentDenial,
  assignmentGaps,
  canAssignParticipants,
  executesFirstTask,
  firstTaskPeopleOf,
  firstWorkTask,
  approvalStepsWithoutQualityPool,
  exclusiveRoleClash,
  normalizeAssignmentProposal,
  poolSlotRoleDenial,
  parseAssignmentPolicy,
  sgcAssignmentPolicy,
  type SgcAssignerInput,
} from '../flows/assignment';
import { assertAssignmentComplete, createRequest, decideTask, setSigners } from '../db/requests';
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

  it('el solicitante NUNCA selecciona en su propia solicitud, aunque sea el elaborador y tenga el permiso de Calidad', () => {
    for (const policy of ['tarea', 'calidad', 'tarea_o_calidad', 'tarea_y_calidad'] as const) {
      expect(assignmentDenial(V3, who(SOL, true, { elaboratorEmail: SOL }), policy)).toMatch(/Quien hace la solicitud no selecciona/);
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

  it('la sugerencia del solicitante es texto libre opcional (máximo 2000)', () => {
    expect(normalizeAssignmentProposal(undefined)).toBeNull();
    expect(normalizeAssignmentProposal('   ')).toBeNull();
    expect(normalizeAssignmentProposal('  Revisa Ana; aprueba la DT; divulgar a Producción ')).toBe('Revisa Ana; aprueba la DT; divulgar a Producción');
    expect(() => normalizeAssignmentProposal(['ana@x.co'])).toThrow(/debe ser texto/);
    expect(() => normalizeAssignmentProposal('x'.repeat(2001))).toThrow(/2000/);
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

describe('SGC · el servidor impide que el solicitante seleccione o se autoasigne', () => {
  beforeEach(() => {
    h.def = V3;
    h.pools = [];
  });
  afterEach(() => vi.unstubAllEnvs());

  it('setSigners: el solicitante no selecciona revisores aunque tenga el permiso de Calidad (403, sin escribir nada)', async () => {
    const f = signersDb();
    await expect(setSigners(f.db, notifier, 7, { stepKey: 'revision', signers: [REV] }, actor(SOL), access(true))).rejects.toMatchObject({ status: 403, message: expect.stringMatching(/Quien hace la solicitud no selecciona/) });
    expect(f.writes('sgcRequestSigner')).toEqual([]);
    expect(f.writes('sgcInteraction')).toEqual([]);
  });

  it('setSigners: el solicitante que se nombró elaborador tampoco puede autoasignarse ni elegir firmantes', async () => {
    const f = fakeDb({ sgcRequest: { findUniqueOrThrow: () => ({ ...requestRow, elaborator_email: SOL }) }, subprocessUserCompany: { findMany: () => eligibleRows } });
    await expect(setSigners(f.db, notifier, 7, { stepKey: 'aprobacion', signers: [SOL] }, actor(SOL), access(true))).rejects.toMatchObject({ status: 403 });
    expect(f.writes('sgcRequestSigner')).toEqual([]);
  });

  it('setSigners: alguien de Calidad que no ejecuta la primera tarea no selecciona con la política por defecto; sí con tarea_o_calidad', async () => {
    await expect(setSigners(signersDb().db, notifier, 7, { stepKey: 'revision', signers: [REV] }, actor(CAL), access(true))).rejects.toMatchObject({ status: 403 });
    vi.stubEnv('SGC_ASIGNACION_PERMISO', 'tarea_o_calidad');
    expect(await setSigners(signersDb().db, notifier, 7, { stepKey: 'revision', signers: [REV] }, actor(CAL), access(true))).toEqual({ changed: true });
  });

  it('setSigners: quien crea el documento (Calidad) no puede poner al solicitante ni a sí mismo como firmante', async () => {
    await expect(setSigners(signersDb().db, notifier, 7, { stepKey: 'revision', signers: [REV, SOL] }, actor(ELAB), access(true))).rejects.toThrow(/Quien hizo la solicitud no puede ser firmante/);
    await expect(setSigners(signersDb().db, notifier, 7, { stepKey: 'aprobacion', signers: [ELAB] }, actor(ELAB), access(true))).rejects.toThrow(/El elaborador no puede ser firmante/);
  });

  it('setSigners: quien crea el documento con permiso de Calidad selecciona, y queda en el historial y la auditoría', async () => {
    const f = signersDb();
    expect(await setSigners(f.db, notifier, 7, { stepKey: 'revision', signers: [REV, APR], mode: 'paralelo' }, actor(ELAB), access(true))).toEqual({ changed: true });
    expect(f.writes('sgcRequestSigner').map((c) => (c.args as { data: { user_email: string; added_by: string } }).data)).toEqual([
      expect.objectContaining({ user_email: REV, added_by: ELAB }),
      expect.objectContaining({ user_email: APR, added_by: ELAB }),
    ]);
    const note = f.writes('sgcInteraction')[0].args as { data: { kind: string; body: string } };
    expect(note.data).toMatchObject({ kind: 'firmantes', body: expect.stringMatching(/Asignó los firmantes de «Revisión»/) });
    expect(f.writes('sgcAuditLog')).toHaveLength(1);
  });

  it('setSigners: sin permiso de Calidad, el elaborador no selecciona con la política por defecto', async () => {
    await expect(setSigners(signersDb().db, notifier, 7, { stepKey: 'revision', signers: [REV] }, actor(ELAB), access(false))).rejects.toMatchObject({ status: 403 });
  });

  it('alcance: el solicitante no agrega ni retira divulgación; quien crea el documento sí, con historial y auditoría', async () => {
    const f = signersDb();
    await expect(addScopeEntry(f.db, notifier, access(true), 7, { entry: { kind: 'empresa' }, reason: 'Toda la empresa' }, actor(SOL))).rejects.toMatchObject({ status: 403 });
    await expect(removeScopeEntry(f.db, access(true), 7, 1, { reason: 'Retirar la entrada' }, actor(SOL))).rejects.toMatchObject({ status: 403 });
    expect(f.writes('sgcDisseminationScope')).toEqual([]);
    expect(await addScopeEntry(f.db, notifier, access(true), 7, { entry: { kind: 'empresa' }, reason: 'Toda la empresa' }, actor(ELAB))).toMatchObject({ idScope: 1 });
    expect(f.writes('sgcDisseminationScope')).toHaveLength(1);
    expect(f.writes('sgcAuditLog')).toHaveLength(1);
  });

  describe('createRequest', () => {
    const input = { idCompany: 1, requestType: 'nuevo', subject: 'Procedimiento nuevo', description: 'Justificación de la prueba.', idProcess: 5, idDocumentType: 6, formValues: { urgencia: 'Normal' } };
    const createDb = (qualityCount = 1) =>
      fakeDb({
        subprocessUserCompany: { findMany: () => eligibleRows, count: () => qualityCount },
        sgcProcessMap: { findFirst: () => ({ id_process_map: 5 }) },
        sgcDocumentType: { findFirst: () => ({ id_document_type: 6 }) },
        sgcRequest: { findUniqueOrThrow: () => ({ ...requestRow, request_type: 'nuevo', documentType: { requires_training: true } }) },
        sgcFlowTaskDef: { findUniqueOrThrow: () => ({ id_flow_task_def: 1 }), findUnique: () => ({ id_flow_task_def: 2 }) },
        sgcAuthorizationType: { findUnique: () => ({ id_authorization_type: 1, is_active: true }) },
        sgcFlowFormField: { findMany: () => [{ task_key: null, field_key: 'urgencia', id_flow_form_field: 1 }, { task_key: null, field_key: 'referencia_cambio', id_flow_form_field: 2 }] },
      });

    it('quien solicita no puede nombrarse elaborador (sería quien selecciona a sus firmantes)', async () => {
      const f = createDb();
      await expect(createRequest(f.db, notifier, access(true), { ...input, elaboratorEmail: SOL }, actor(SOL))).rejects.toThrow(/Elija como elaborador a quien crea el documento/);
      await expect(createRequest(f.db, notifier, access(true), input, actor(SOL))).rejects.toThrow(/Elija como elaborador/);
      expect(f.writes('sgcRequest')).toEqual([]);
    });

    it('con la política por defecto, el elaborador debe tener el permiso de Calidad', async () => {
      await expect(createRequest(createDb(0).db, notifier, access(true), { ...input, elaboratorEmail: ELAB }, actor(SOL))).rejects.toThrow(/no tiene el permiso de Aseguramiento de Calidad/);
    });

    it('la sugerencia libre del solicitante queda como NOTA del historial y en la auditoría; no crea firmantes ni alcance', async () => {
      const f = createDb();
      await createRequest(f.db, notifier, access(true), { ...input, elaboratorEmail: ELAB, assignmentProposal: 'Revisa Ana; aprueba la DT; divulgar a Producción' }, actor(SOL));
      const notes = f.writes('sgcInteraction').map((c) => (c.args as { data: { kind: string; body: string; meta_json: string | null } }).data);
      expect(notes).toContainEqual(expect.objectContaining({ kind: 'nota', body: `${SGC_PROPOSAL_NOTE_PREFIX}\nRevisa Ana; aprueba la DT; divulgar a Producción`, meta_json: JSON.stringify({ assignmentProposal: true }) }));
      expect(f.writes('sgcRequestSigner')).toEqual([]);
      expect(f.writes('sgcDisseminationScope')).toEqual([]);
      const audit = f.writes('sgcAuditLog').map((c) => JSON.stringify(c.args));
      expect(audit.some((a) => a.includes('Revisa Ana'))).toBe(true);
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
