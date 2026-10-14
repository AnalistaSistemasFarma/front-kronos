import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assignmentDenial, firstWorkTask } from '../flows/assignment';
import { SGC_ROLE_MODEL_LABELS, describeDefinitionChanges, normalizeFlowDefinition, parseRoleModel, requesterElaborates, type SgcFlowDefinition } from '../flows/definition';
import { SGC_DOCUMENT_FLOW_TRAINING_FIRST, SGC_DOCUMENT_FLOW_V7, SGC_TASK_CREATION_AUTHORIZATION } from '../flows/documentFlow';
import { normalizeSigners, resolveNextStep } from '../flows/engine';
import {
  assignmentStepKey,
  creationAuthorizationDenial,
  departmentLeaderDenial,
  departmentLeaderPolicyApplies,
  departmentSignerDenial,
  departmentSignerOptions,
  elaborationStep,
  normalizeRejectionReason,
  roleModelAssignmentDenial,
  type SgcDepartmentContext,
} from '../flows/roleModel';
import { SGC_COMPANY_FLAGS, parseCompanyFlag } from '../db/companySettings';
import { instructorChoiceOf, instructorValueOf } from '../../../components/sgc/tareas/SgcTrainingCard';

/**
 * S15 (plan sgc-plan-sprints-requerimientos-2026-10-13): NUEVO MODELO DE ROLES
 * del flujo documental, DOC v7 — R15 (Calidad autoriza la creación), R16 (el
 * solicitante elabora, D15), R17 (firmantes del departamento), R18 (revisor del
 * área o de Calidad, nunca el elaborador, D14), R19 (aprueba el líder, D16 sin
 * restricción por defecto) y R27 (el creador prepara y dicta la capacitación).
 */

const root = join(__dirname, '../../..');
const src = (p: string) => readFileSync(join(root, p), 'utf8');
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

const ctx = (over: Partial<SgcDepartmentContext> = {}): SgcDepartmentContext => ({
  elaboratorDepartments: new Set([10]),
  departmentsOf: new Map<string, Set<number>>([
    ['elab@olp.co', new Set([10])],
    ['par@olp.co', new Set([10, 20])],
    ['jefe@olp.co', new Set([10])],
    ['otro@olp.co', new Set([30])],
    ['calidad@olp.co', new Set([40])],
  ]),
  quality: new Set(['calidad@olp.co']),
  departmentNames: new Map([
    [10, 'Producción'],
    [20, 'Logística'],
    [30, 'Mercadeo'],
    [40, 'Garantía de Calidad'],
  ]),
  ...over,
});

describe('SGC · S15 · flujo DOC v7 (definición)', () => {
  it('[SGC-REQ-158] la definición v7 es válida, conserva el modelo de roles y agrega la autorización de la creación en el orden 1', () => {
    const def = normalizeFlowDefinition(clone(SGC_DOCUMENT_FLOW_V7));
    expect(def.roleModel).toBe('solicitante_elabora');
    expect(requesterElaborates(def)).toBe(true);
    expect(def.tasks.map((t) => [t.key, t.stepOrder, t.assignment])).toEqual([
      ['solicitud', 0, 'solicitante'],
      [SGC_TASK_CREATION_AUTHORIZATION, 1, 'calidad'],
      ['elaboracion', 2, 'elaborador'],
      ['revision', 3, 'firmantes'],
      ['aprobacion', 4, 'firmantes'],
      ['preparacion_capacitacion', 5, 'creador'],
      ['divulgacion', 6, 'alcance'],
      ['capacitacion', 7, 'creador'],
    ]);
    const auth = def.tasks.find((t) => t.key === SGC_TASK_CREATION_AUTHORIZATION)!;
    expect(auth).toMatchObject({ isAuthorization: true, authorizationTypeCode: 'SGC-VERIF-CALIDAD', poolAuthorizationTypeCode: 'SGC-VERIF-CALIDAD', signatureMeaning: null });
    // R27 / D18: la preparación ya no tiene grupo; la capacitación conserva el cupo de Calidad para el cierre.
    expect(def.tasks.find((t) => t.key === 'preparacion_capacitacion')!.poolAuthorizationTypeCode).toBeNull();
    expect(def.tasks.find((t) => t.key === 'capacitacion')!.poolAuthorizationTypeCode).toBe('SGC-VERIF-CALIDAD');
    // Las versiones anteriores no traen modelo (siguen igual).
    expect(normalizeFlowDefinition(clone(SGC_DOCUMENT_FLOW_TRAINING_FIRST)).roleModel).toBeUndefined();
    expect(parseRoleModel(null)).toBe('calidad_asigna');
    expect(parseRoleModel('otra')).toBe('calidad_asigna');
  });

  it('[SGC-REQ-158] R15: la solicitud va a la autorización; autorizar lleva a la elaboración y RECHAZAR cierra la solicitud como cancelada', () => {
    const ctxCond = { requestType: 'nuevo', requiresTraining: false };
    expect(resolveNextStep(SGC_DOCUMENT_FLOW_V7, 'solicitud', 'aprobar', ctxCond)).toMatchObject({ kind: 'task', task: { key: SGC_TASK_CREATION_AUTHORIZATION } });
    expect(resolveNextStep(SGC_DOCUMENT_FLOW_V7, SGC_TASK_CREATION_AUTHORIZATION, 'aprobar', ctxCond)).toMatchObject({ kind: 'task', task: { key: 'elaboracion' } });
    expect(resolveNextStep(SGC_DOCUMENT_FLOW_V7, SGC_TASK_CREATION_AUTHORIZATION, 'rechazar', ctxCond)).toEqual({ kind: 'terminal', status: 'cancelada' });
    expect(() => resolveNextStep(SGC_DOCUMENT_FLOW_V7, 'elaboracion', 'rechazar', ctxCond)).toThrow(/no está disponible/);
    // Sin capacitación se salta la preparación y la capacitación.
    expect(resolveNextStep(SGC_DOCUMENT_FLOW_V7, 'aprobacion', 'aprobar', ctxCond)).toMatchObject({ kind: 'task', task: { key: 'divulgacion' } });
    expect(resolveNextStep(SGC_DOCUMENT_FLOW_V7, 'aprobacion', 'aprobar', { ...ctxCond, requiresTraining: true })).toMatchObject({ kind: 'task', task: { key: 'preparacion_capacitacion' } });
  });

  it('[SGC-REQ-158] «rechazar» solo cierra, solo desde una autorización; «creador» solo con el modelo v7; el modelo se valida y queda en el registro de cambios', () => {
    const base = clone(SGC_DOCUMENT_FLOW_V7);
    expect(() => normalizeFlowDefinition({ ...base, transitions: base.transitions.map((t) => (t.action === 'rechazar' ? { ...t, terminalStatus: null, to: 'elaboracion' } : t)) })).toThrow(/rechazar.*cierra/);
    expect(() => normalizeFlowDefinition({ ...base, transitions: [...base.transitions, { from: 'revision', action: 'rechazar', to: null, terminalStatus: 'cancelada' }] })).toThrow(/autorización/);
    expect(() => normalizeFlowDefinition({ ...base, roleModel: undefined })).toThrow(/creador.*v7/);
    expect(() => normalizeFlowDefinition({ ...base, roleModel: 'libre' })).toThrow(/Modelo de roles no permitido/);
    expect(() => normalizeFlowDefinition({ ...base, tasks: base.tasks.map((t) => (t.assignment === 'elaborador' ? { ...t, isEnabled: false } : t)) })).toThrow(/paso de elaboración/);
    const changes = describeDefinitionChanges(clone(SGC_DOCUMENT_FLOW_TRAINING_FIRST), clone(SGC_DOCUMENT_FLOW_V7));
    expect(changes[0]).toBe(`Modelo de roles: ${SGC_ROLE_MODEL_LABELS.calidad_asigna} → ${SGC_ROLE_MODEL_LABELS.solicitante_elabora}.`);
    expect(changes).toContain(`Tarea agregada: Autorización de la creación (${SGC_TASK_CREATION_AUTHORIZATION}).`);
  });
});

describe('SGC · S15 · quién asigna y quién firma (R16 a R19)', () => {
  const legacy = SGC_DOCUMENT_FLOW_TRAINING_FIRST as SgcFlowDefinition;
  const v7 = SGC_DOCUMENT_FLOW_V7;
  const input = (email: string, isQuality = false) => ({ email, isQuality, poolTypeCodes: [], requesterEmail: 'elab@olp.co', elaboratorEmail: 'elab@olp.co' });

  it('[SGC-REQ-159] R16/R17: en el DOC v7 asigna el elaborador (que es el solicitante) o, como excepción, Calidad; antes el solicitante solo sugería', () => {
    expect(assignmentDenial(v7, input('elab@olp.co'), 'tarea_y_calidad')).toBeNull();
    expect(assignmentDenial(v7, input('calidad@olp.co', true), 'tarea')).toBeNull();
    expect(assignmentDenial(v7, input('otro@olp.co'))).toMatch(/quien elabora el documento/);
    expect(roleModelAssignmentDenial({ email: 'ELAB@olp.co', elaboratorEmail: 'elab@olp.co', isQuality: false })).toBeNull();
    // Versión anterior: el solicitante nunca selecciona (RN 2026-10-05).
    expect(assignmentDenial(legacy, input('elab@olp.co'))).toMatch(/solo sugiere/);
  });

  it('[SGC-REQ-159] los firmantes se exigen al ENVIAR la elaboración (v7) y no al autorizar la creación; antes, en la primera tarea', () => {
    expect(firstWorkTask(v7)?.key).toBe(SGC_TASK_CREATION_AUTHORIZATION);
    expect(elaborationStep(v7)?.key).toBe('elaboracion');
    expect(assignmentStepKey(v7, firstWorkTask(v7)?.key ?? null)).toBe('elaboracion');
    expect(assignmentStepKey(legacy, firstWorkTask(legacy)?.key ?? null)).toBe('elaboracion');
    expect(assignmentStepKey(legacy, 'otra')).toBe('otra');
  });

  it('[SGC-REQ-160] R17/R18: revisor del departamento o de Calidad; aprobador solo del departamento; sin departamento no se asigna', () => {
    const c = ctx();
    expect(departmentSignerDenial('par@olp.co', 'revision', 'Revisión', c)).toBeNull();
    expect(departmentSignerDenial('calidad@olp.co', 'revision', 'Revisión', c)).toBeNull();
    expect(departmentSignerDenial('otro@olp.co', 'revision', 'Revisión', c)).toMatch(/no es del departamento de quien elabora \(Producción\) ni de Aseguramiento de Calidad/);
    expect(departmentSignerDenial('jefe@olp.co', 'aprobacion', 'Aprobación', c)).toBeNull();
    expect(departmentSignerDenial('calidad@olp.co', 'aprobacion', 'Aprobación', c)).toMatch(/no puede quedar en «Aprobación»/);
    expect(departmentSignerDenial('sin.depto@olp.co', 'aprobacion', 'Aprobación', c)).toMatch(/no es del departamento/);
    expect(departmentSignerDenial('jefe@olp.co', 'revision', 'Revisión', ctx({ elaboratorDepartments: new Set() }))).toMatch(/no tiene departamento asignado.*R40/);
    expect(departmentSignerOptions(['elab@olp.co', 'par@olp.co', 'jefe@olp.co', 'otro@olp.co', 'calidad@olp.co'], c)).toEqual({
      reviewers: ['elab@olp.co', 'par@olp.co', 'jefe@olp.co', 'calidad@olp.co'],
      approvers: ['elab@olp.co', 'par@olp.co', 'jefe@olp.co'],
    });
  });

  it('[SGC-REQ-160] R18: nadie revisa ni aprueba lo que elaboró; con D14 encendida, Calidad sí revisa lo que elaboró (solo revisión)', () => {
    const base = { stepName: 'Revisión', elaboratorEmail: 'elab@olp.co', requesterEmail: 'elab@olp.co', eligibleEmails: new Set(['elab@olp.co', 'par@olp.co']) };
    expect(() => normalizeSigners(['elab@olp.co'], { ...base, kind: 'revision', segregation: { quality: new Set(), qualitySelfReview: true } })).toThrow(/El elaborador no puede/);
    expect(normalizeSigners(['elab@olp.co'], { ...base, kind: 'revision', segregation: { quality: new Set(['elab@olp.co']), qualitySelfReview: true } })).toEqual([{ email: 'elab@olp.co', order: 1 }]);
    expect(() => normalizeSigners(['elab@olp.co'], { ...base, kind: 'revision', segregation: { quality: new Set(['elab@olp.co']), qualitySelfReview: false } })).toThrow(/El elaborador no puede/);
    expect(() => normalizeSigners(['elab@olp.co'], { ...base, stepName: 'Aprobación', kind: 'aprobacion', segregation: { quality: new Set(['elab@olp.co']), qualitySelfReview: true } })).toThrow(/El elaborador no puede/);
  });

  it('[SGC-REQ-161] R19/D16: la lista de líderes por departamento solo se aplica con el ajuste encendido; sin líderes cargados AVISA (no deja pasar)', () => {
    expect(departmentLeaderPolicyApplies(false)).toBe(false);
    expect(departmentLeaderPolicyApplies(true)).toBe(true);
    const day = new Date('2026-10-14T00:00:00Z').getTime();
    const d = (s: string) => new Date(`${s}T00:00:00Z`);
    const list = [
      { user_email: 'jefe@olp.co', id_department: 10, valid_from: d('2026-10-01'), valid_to: null, revoked_at: null },
      { user_email: 'par@olp.co', id_department: 10, valid_from: d('2026-10-01'), valid_to: d('2026-10-10'), revoked_at: null },
      { user_email: 'otro@olp.co', id_department: 30, valid_from: d('2026-10-01'), valid_to: null, revoked_at: null },
    ];
    const names = new Map([[10, 'Producción']]);
    expect(departmentLeaderDenial(['jefe@olp.co'], list, new Set([10]), day, 'Aprobación', names)).toBeNull();
    expect(departmentLeaderDenial(['par@olp.co'], list, new Set([10]), day, 'Aprobación', names)).toMatch(/par@olp\.co no es líder aprobador vigente del departamento de quien elabora \(Producción\)/);
    expect(departmentLeaderDenial(['otro@olp.co', 'par@olp.co'], list, new Set([10]), day, 'Aprobación', names)).toMatch(/no son líderes aprobadores vigentes/);
    expect(departmentLeaderDenial(['jefe@olp.co'], [{ ...list[0], revoked_at: d('2026-10-12') }], new Set([10]), day, 'Aprobación', names)).toMatch(/no es líder/);
    expect(departmentLeaderDenial(['jefe@olp.co'], list, new Set([20]), day, 'Aprobación')).toMatch(/no tiene líderes aprobadores cargados/);
    expect(departmentLeaderDenial(['jefe@olp.co'], [{ ...list[0], id_department: null }], new Set([10]), day, 'Aprobación', names)).toMatch(/no tiene líderes aprobadores cargados/);
  });

  it('[SGC-REQ-158] D15: la creación de una solicitud propia la autoriza OTRA persona de Calidad; el rechazo exige motivo', () => {
    expect(creationAuthorizationDenial('Calidad@olp.co', 'calidad@olp.co')).toMatch(/otra persona de Aseguramiento de Calidad/);
    expect(creationAuthorizationDenial('otra.calidad@olp.co', 'calidad@olp.co')).toBeNull();
    expect(normalizeRejectionReason('corto')).toBe('');
    expect(normalizeRejectionReason('  Ya existe el OLP-GGC-PR-001 vigente.  ')).toBe('Ya existe el OLP-GGC-PR-001 vigente.');
    expect(normalizeRejectionReason('x'.repeat(1200))).toHaveLength(1000);
  });
});

describe('SGC · S15 · ajustes por empresa y capacitación del creador (D16, D18, R27)', () => {
  it('[SGC-REQ-161] D16 nace APAGADO y D18 ENCENDIDO; el valor es la última fila del control de cambios', () => {
    expect(parseCompanyFlag(null, SGC_COMPANY_FLAGS.departmentLeaders)).toBe(false);
    expect(parseCompanyFlag('{"enforced":true}', SGC_COMPANY_FLAGS.departmentLeaders)).toBe(true);
    expect(parseCompanyFlag('no-json', SGC_COMPANY_FLAGS.departmentLeaders)).toBe(false);
    expect(parseCompanyFlag(null, SGC_COMPANY_FLAGS.trainingClosedByQuality)).toBe(true);
    expect(parseCompanyFlag('{"qualityCloses":false}', SGC_COMPANY_FLAGS.trainingClosedByQuality)).toBe(false);
    expect(parseCompanyFlag('{"otro":false}', SGC_COMPANY_FLAGS.trainingClosedByQuality)).toBe(true);
  });

  it('[SGC-REQ-162] R27: «Quién dicta» se elige entre las personas o «Externo» con su nombre (se guarda como texto legible)', () => {
    const users = [{ value: 'ana@olp.co', label: 'ANA GÓMEZ (ana@olp.co)' }];
    expect(instructorValueOf('ana@olp.co', '', users)).toBe('ANA GÓMEZ (ana@olp.co)');
    expect(instructorValueOf('__externo__', ' Laboratorio Asesor ', users)).toBe('Externo: Laboratorio Asesor');
    expect(instructorValueOf('__externo__', '  ', users)).toBe('');
    expect(instructorValueOf(null, '', users)).toBe('');
    expect(instructorChoiceOf('ANA GÓMEZ (ana@olp.co)', users)).toEqual({ choice: 'ana@olp.co', external: '' });
    expect(instructorChoiceOf('Externo: Laboratorio Asesor', users)).toEqual({ choice: '__externo__', external: 'Laboratorio Asesor' });
    expect(instructorChoiceOf('Texto libre de antes', users)).toEqual({ choice: '__externo__', external: 'Texto libre de antes' });
    expect(instructorChoiceOf(null, users)).toEqual({ choice: null, external: '' });
  });

  it('[SGC-REQ-158] el SQL del DOC v7 coincide con la definición (tareas, asignaciones y transiciones) y su reversa vuelve al modelo anterior', () => {
    const seed = src('prisma/manual/2026-10-14-sgc-s15-flujo-doc-v7-olp.sql');
    expect(seed).toContain("N'autorizacion_creacion', N'Autorización de la creación', 1, N'calidad', N'calidad'");
    expect(seed).toContain("(@IdVersion, N'autorizacion_creacion', N'rechazar', NULL, N'cancelada')");
    expect(seed).toContain("WHEN task_key IN (N'preparacion_capacitacion', N'capacitacion') THEN N'creador'");
    expect(seed).toContain("role_model = N''solicitante_elabora''");
    expect(seed).toMatch(/DECLARE @IdCompany INT = 3;/);
    const rev = src('prisma/manual/2026-10-14-sgc-s15-flujo-doc-v7-reversa.sql');
    expect(rev).toContain("task_key <> N'autorizacion_creacion'");
    expect(rev).toContain("WHEN assignment = N'creador' THEN N'calidad'");
    const ddl = src('prisma/migrations/20261014100000_sgc_s15_modelo_roles/migration.sql');
    expect(ddl).toContain("sp_set_session_context N'sgc_ddl_autorizado', 1");
    expect(ddl).toMatch(/N''rechazar''/);
    const ddlRev = src('prisma/manual/2026-10-14-sgc-s15-modelo-roles-reversa.sql');
    expect(ddlRev).toContain('sgc_reversa_modelo_roles');
    expect(ddlRev).toContain('sgc_reversa_lideres_departamento');
  });
});
