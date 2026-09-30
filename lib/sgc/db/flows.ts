import type { Prisma } from '../../../app/generated/prisma';
import { SGC_AUDIT_ACTIONS, writeSgcAudit } from '../audit';
import { SgcError, isUniqueViolation } from '../errors';
import {
  SGC_FLOW_CATEGORIES,
  describeDefinitionChanges,
  normalizeFlowDefinition,
  requiredAuthorizationTypes,
  type SgcFlowDefinition,
} from '../flows/definition';
import type { SgcActor, SgcDb } from './catalogs';

/**
 * Administración de flujos validados (Sprint 2) sobre sgc.flow_*.
 *
 * - Cada proceso tiene versiones: borrador → vigente → retirada. Solo se
 *   edita un BORRADOR; la vigente no se toca (se crea una nueva versión).
 * - Publicar deja la vigente anterior como retirada; las solicitudes en curso
 *   siguen con la versión con la que arrancaron.
 * - TODO cambio de configuración exige motivo y queda en
 *   sgc.config_change_log (solo inserción) con el antes/después, y en
 *   sgc.audit_log.
 */

type Tx = Prisma.TransactionClient | SgcDb;

export interface SgcConfigChange {
  idCompany: number;
  entity: string;
  entityId?: string | number | null;
  idFlowProcess?: number | null;
  idFlowVersion?: number | null;
  action: string;
  reason: string;
  changeReference?: string | null;
  before?: unknown;
  after?: unknown;
}

function json(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
}

export function requireReason(value: unknown, label = 'El motivo del cambio'): string {
  const s = typeof value === 'string' ? value.trim() : '';
  if (s.length < 5) throw new SgcError(`${label} es obligatorio (mínimo 5 caracteres).`);
  if (s.length > 1000) throw new SgcError(`${label} admite máximo 1000 caracteres.`);
  return s;
}

function optionalReference(value: unknown): string | null {
  const s = typeof value === 'string' ? value.trim() : '';
  if (!s) return null;
  if (s.length > 100) throw new SgcError('La referencia al control de cambios admite máximo 100 caracteres.');
  return s;
}

/** Inserta una fila en el registro de cambios de configuración. */
export async function writeConfigChange(db: Tx, change: SgcConfigChange, actor: SgcActor): Promise<void> {
  await db.sgcConfigChangeLog.create({
    data: {
      id_company: change.idCompany,
      actor_email: actor.email,
      entity: change.entity,
      entity_id: change.entityId === undefined || change.entityId === null ? null : String(change.entityId),
      id_flow_process: change.idFlowProcess ?? null,
      id_flow_version: change.idFlowVersion ?? null,
      action: change.action,
      reason: change.reason,
      change_reference: change.changeReference ?? null,
      before_json: json(change.before),
      after_json: json(change.after),
      ip: actor.ip ?? null,
      user_agent: actor.userAgent ?? null,
    },
  });
}

// ---------------------------------------------------------------------------
// Lectura de definiciones
// ---------------------------------------------------------------------------

/** Definición guardada de una versión, en la forma del motor. */
export async function loadDefinition(db: Tx, idFlowVersion: number): Promise<SgcFlowDefinition> {
  const [tasks, transitions, fields] = await Promise.all([
    db.sgcFlowTaskDef.findMany({ where: { id_flow_version: idFlowVersion }, orderBy: { step_order: 'asc' } }),
    db.sgcFlowTransition.findMany({ where: { id_flow_version: idFlowVersion }, orderBy: { id_flow_transition: 'asc' } }),
    db.sgcFlowFormField.findMany({ where: { id_flow_version: idFlowVersion }, orderBy: [{ sort_order: 'asc' }, { id_flow_form_field: 'asc' }] }),
  ]);
  return {
    tasks: tasks.map((t) => ({
      key: t.task_key,
      name: t.name,
      stepOrder: t.step_order,
      role: t.role as SgcFlowDefinition['tasks'][number]['role'],
      assignment: t.assignment as SgcFlowDefinition['tasks'][number]['assignment'],
      multiAssignee: t.multi_assignee,
      signingModeDefault: (t.signing_mode_default as 'orden' | 'paralelo' | null) ?? null,
      signatureMeaning: (t.signature_meaning as SgcFlowDefinition['tasks'][number]['signatureMeaning']) ?? null,
      targetDays: t.target_days,
      conditionKey: (t.condition_key as SgcFlowDefinition['tasks'][number]['conditionKey']) ?? null,
      isAuthorization: t.is_authorization,
      authorizationTypeCode: t.authorization_type_code,
      poolAuthorizationTypeCode: t.pool_authorization_type_code,
      isEnabled: t.is_enabled,
      description: t.description,
    })),
    transitions: transitions.map((t) => ({
      from: t.from_task_key,
      action: t.action as 'aprobar' | 'devolver' | 'cancelar',
      to: t.to_task_key,
      terminalStatus: (t.terminal_status as 'completada' | 'cancelada' | null) ?? null,
    })),
    formFields: fields.map((f) => ({
      taskKey: f.task_key,
      key: f.field_key,
      label: f.label,
      type: f.field_type as SgcFlowDefinition['formFields'][number]['type'],
      required: f.required,
      options: parseOptions(f.options_json),
      helpText: f.help_text,
      sortOrder: f.sort_order,
    })),
  };
}

export function parseOptions(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

export interface SgcFlowVersionSummary {
  id: number;
  versionNumber: number;
  status: string;
  changeReason: string;
  createdBy: string;
  createdAt: string;
  publishedBy: string | null;
  publishedAt: string | null;
  retiredAt: string | null;
  requestCount: number;
}

export interface SgcFlowProcessSummary {
  id: number;
  code: string;
  name: string;
  description: string | null;
  category: string;
  ownerEmail: string | null;
  isActive: boolean;
  versions: SgcFlowVersionSummary[];
  currentVersion: number | null;
  draftVersionId: number | null;
}

function versionSummary(v: {
  id_flow_version: number;
  version_number: number;
  status: string;
  change_reason: string;
  created_by: string;
  created_at: Date;
  published_by: string | null;
  published_at: Date | null;
  retired_at: Date | null;
  _count?: { requests: number };
}): SgcFlowVersionSummary {
  return {
    id: v.id_flow_version,
    versionNumber: v.version_number,
    status: v.status,
    changeReason: v.change_reason,
    createdBy: v.created_by,
    createdAt: v.created_at.toISOString(),
    publishedBy: v.published_by,
    publishedAt: v.published_at?.toISOString() ?? null,
    retiredAt: v.retired_at?.toISOString() ?? null,
    requestCount: v._count?.requests ?? 0,
  };
}

/** Procesos validados de la empresa con sus versiones. */
export async function listFlowProcesses(db: SgcDb, idCompany: number): Promise<SgcFlowProcessSummary[]> {
  const rows = await db.sgcFlowProcess.findMany({
    where: { id_company: idCompany },
    include: { versions: { include: { _count: { select: { requests: true } } }, orderBy: { version_number: 'desc' } } },
    orderBy: [{ is_active: 'desc' }, { name: 'asc' }],
  });
  return rows.map((p) => ({
    id: p.id_flow_process,
    code: p.code,
    name: p.name,
    description: p.description,
    category: p.category,
    ownerEmail: p.owner_email,
    isActive: p.is_active,
    versions: p.versions.map(versionSummary),
    currentVersion: p.versions.find((v) => v.status === 'vigente')?.version_number ?? null,
    draftVersionId: p.versions.find((v) => v.status === 'borrador')?.id_flow_version ?? null,
  }));
}

async function versionOfCompany(db: Tx, idCompany: number, idFlowVersion: number) {
  const version = await db.sgcFlowVersion.findUnique({ where: { id_flow_version: idFlowVersion }, include: { process: true } });
  if (!version || version.process.id_company !== idCompany) throw new SgcError('Versión de flujo no encontrada.', 404);
  return version;
}

export interface SgcFlowVersionDetail {
  process: { id: number; code: string; name: string; category: string; isActive: boolean };
  version: SgcFlowVersionSummary;
  definition: SgcFlowDefinition;
}

export async function getFlowVersion(db: SgcDb, idCompany: number, idFlowVersion: number): Promise<SgcFlowVersionDetail> {
  const v = await versionOfCompany(db, idCompany, idFlowVersion);
  const count = await db.sgcRequest.count({ where: { id_flow_version: idFlowVersion } });
  return {
    process: { id: v.process.id_flow_process, code: v.process.code, name: v.process.name, category: v.process.category, isActive: v.process.is_active },
    version: versionSummary({ ...v, _count: { requests: count } }),
    definition: await loadDefinition(db, idFlowVersion),
  };
}

/** Versión VIGENTE de un proceso por código (la que usa una solicitud nueva). */
export async function getCurrentFlowVersion(db: Tx, idCompany: number, code: string) {
  const process = await db.sgcFlowProcess.findUnique({ where: { id_company_code: { id_company: idCompany, code } } });
  if (!process || !process.is_active) throw new SgcError('El flujo no está configurado o está inactivo en esta empresa.', 409);
  const version = await db.sgcFlowVersion.findFirst({ where: { id_flow_process: process.id_flow_process, status: 'vigente' } });
  if (!version) throw new SgcError('El flujo no tiene una versión vigente publicada.', 409);
  return { process, version };
}

// ---------------------------------------------------------------------------
// Escritura (solo con permiso de administración de flujos; la ruta lo verifica)
// ---------------------------------------------------------------------------

async function assertAuthorizationTypes(db: Tx, idCompany: number, def: SgcFlowDefinition): Promise<void> {
  const codes = requiredAuthorizationTypes(def);
  if (codes.length === 0) return;
  const found = await db.sgcAuthorizationType.findMany({ where: { id_company: idCompany, code: { in: codes }, is_active: true }, select: { code: true } });
  const have = new Set(found.map((f) => f.code));
  const missing = codes.filter((c) => !have.has(c));
  if (missing.length) throw new SgcError(`Tipos de autorización inexistentes o inactivos en la empresa: ${missing.join(', ')}.`);
}

async function writeDefinitionRows(tx: Prisma.TransactionClient, idFlowVersion: number, def: SgcFlowDefinition): Promise<void> {
  // Solo sobre un BORRADOR (aún no validado): se reemplaza entero y el
  // antes/después queda en el registro de cambios.
  await tx.sgcFlowFormField.deleteMany({ where: { id_flow_version: idFlowVersion } });
  await tx.sgcFlowTransition.deleteMany({ where: { id_flow_version: idFlowVersion } });
  await tx.sgcFlowTaskDef.deleteMany({ where: { id_flow_version: idFlowVersion } });
  for (const t of def.tasks) {
    await tx.sgcFlowTaskDef.create({
      data: {
        id_flow_version: idFlowVersion,
        task_key: t.key,
        name: t.name,
        step_order: t.stepOrder,
        role: t.role,
        assignment: t.assignment,
        multi_assignee: t.multiAssignee,
        signing_mode_default: t.signingModeDefault,
        signature_meaning: t.signatureMeaning,
        target_days: t.targetDays,
        condition_key: t.conditionKey,
        is_authorization: t.isAuthorization,
        authorization_type_code: t.authorizationTypeCode,
        pool_authorization_type_code: t.poolAuthorizationTypeCode,
        is_enabled: t.isEnabled,
        description: t.description,
      },
    });
  }
  if (def.transitions.length) {
    await tx.sgcFlowTransition.createMany({
      data: def.transitions.map((t) => ({
        id_flow_version: idFlowVersion,
        from_task_key: t.from,
        action: t.action,
        to_task_key: t.to,
        terminal_status: t.terminalStatus,
      })),
    });
  }
  if (def.formFields.length) {
    await tx.sgcFlowFormField.createMany({
      data: def.formFields.map((f) => ({
        id_flow_version: idFlowVersion,
        task_key: f.taskKey,
        field_key: f.key,
        label: f.label,
        field_type: f.type,
        required: f.required,
        options_json: f.options.length ? JSON.stringify(f.options) : null,
        help_text: f.helpText,
        sort_order: f.sortOrder,
      })),
    });
  }
}

/** Plantilla mínima para un flujo nuevo creado desde el administrador. */
export function starterDefinition(): SgcFlowDefinition {
  return normalizeFlowDefinition({
    tasks: [
      { key: 'solicitud', name: 'Solicitud', stepOrder: 0, role: 'solicitante', assignment: 'solicitante' },
      { key: 'ejecucion', name: 'Ejecución', stepOrder: 1, role: 'elaborador', assignment: 'elaborador', signatureMeaning: 'elaboro' },
    ],
    transitions: [
      { from: 'solicitud', action: 'aprobar', to: 'ejecucion' },
      { from: 'solicitud', action: 'cancelar', terminalStatus: 'cancelada' },
      { from: 'ejecucion', action: 'aprobar', terminalStatus: 'completada' },
      { from: 'ejecucion', action: 'cancelar', terminalStatus: 'cancelada' },
    ],
    formFields: [],
  });
}

const TX_OPTS = { maxWait: 10_000, timeout: 30_000 } as const;

export interface SgcCreateFlowInput {
  code: unknown;
  name: unknown;
  description?: unknown;
  category?: unknown;
  reason: unknown;
  changeReference?: unknown;
}

/** Crea un proceso validado con su versión 1 en BORRADOR (plantilla mínima). */
export async function createFlowProcess(db: SgcDb, idCompany: number, input: SgcCreateFlowInput, actor: SgcActor) {
  const code = typeof input.code === 'string' ? input.code.trim().toUpperCase() : '';
  if (!/^[A-Z][A-Z0-9_-]{1,19}$/.test(code)) throw new SgcError('Código del flujo: mayúsculas y números, 2 a 20 caracteres.');
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name || name.length > 200) throw new SgcError('El nombre del flujo es obligatorio (máximo 200 caracteres).');
  const description = typeof input.description === 'string' && input.description.trim() ? input.description.trim().slice(0, 1000) : null;
  const category = typeof input.category === 'string' && (SGC_FLOW_CATEGORIES as readonly string[]).includes(input.category) ? input.category : 'otro';
  const reason = requireReason(input.reason);
  const changeReference = optionalReference(input.changeReference);
  const def = starterDefinition();
  try {
    return await db.$transaction(async (tx) => {
      const process = await tx.sgcFlowProcess.create({
        data: { id_company: idCompany, code, name, description, category, owner_email: actor.email, created_by: actor.email },
      });
      const version = await tx.sgcFlowVersion.create({
        data: { id_flow_process: process.id_flow_process, version_number: 1, status: 'borrador', change_reason: reason, created_by: actor.email },
      });
      await writeDefinitionRows(tx, version.id_flow_version, def);
      const after = { code, name, description, category, version: 1, definition: def };
      await writeConfigChange(
        tx,
        { idCompany, entity: 'flow_process', entityId: process.id_flow_process, idFlowProcess: process.id_flow_process, idFlowVersion: version.id_flow_version, action: 'proceso.creado', reason, changeReference, after },
        actor
      );
      await writeSgcAudit(tx, { idCompany, actorEmail: actor.email, action: SGC_AUDIT_ACTIONS.flujoConfigurado, entity: 'flow_process', entityId: process.id_flow_process, after: { code, name }, detail: reason, ip: actor.ip, userAgent: actor.userAgent });
      return { idFlowProcess: process.id_flow_process, idFlowVersion: version.id_flow_version };
    }, TX_OPTS);
  } catch (error) {
    if (isUniqueViolation(error)) throw new SgcError(`Ya existe un flujo con el código ${code} en la empresa.`, 409);
    throw error;
  }
}

/** Crea una versión BORRADOR copiando la vigente (o la última). Solo un borrador a la vez. */
export async function createDraftVersion(db: SgcDb, idCompany: number, idFlowProcess: number, input: { reason: unknown; changeReference?: unknown }, actor: SgcActor) {
  const reason = requireReason(input.reason);
  const changeReference = optionalReference(input.changeReference);
  return db.$transaction(async (tx) => {
    const process = await tx.sgcFlowProcess.findUnique({ where: { id_flow_process: idFlowProcess }, include: { versions: { orderBy: { version_number: 'desc' } } } });
    if (!process || process.id_company !== idCompany) throw new SgcError('Flujo no encontrado.', 404);
    if (process.versions.some((v) => v.status === 'borrador')) throw new SgcError('Ya hay una versión en borrador de este flujo: edítela o publíquela.', 409);
    const base = process.versions.find((v) => v.status === 'vigente') ?? process.versions[0];
    const def = base ? await loadDefinition(tx, base.id_flow_version) : starterDefinition();
    const number = (process.versions[0]?.version_number ?? 0) + 1;
    const version = await tx.sgcFlowVersion.create({
      data: { id_flow_process: idFlowProcess, version_number: number, status: 'borrador', change_reason: reason, created_by: actor.email },
    });
    await writeDefinitionRows(tx, version.id_flow_version, def);
    await writeConfigChange(
      tx,
      { idCompany, entity: 'flow_version', entityId: version.id_flow_version, idFlowProcess, idFlowVersion: version.id_flow_version, action: 'version.borrador_creado', reason, changeReference, before: base ? { copiadaDe: base.version_number } : null, after: { version: number } },
      actor
    );
    await writeSgcAudit(tx, { idCompany, actorEmail: actor.email, action: SGC_AUDIT_ACTIONS.flujoConfigurado, entity: 'flow_version', entityId: version.id_flow_version, after: { version: number, from: base?.version_number ?? null }, detail: reason, ip: actor.ip, userAgent: actor.userAgent });
    return { idFlowVersion: version.id_flow_version, versionNumber: number };
  }, TX_OPTS);
}

/** Guarda la definición completa de un BORRADOR (sin código: la arma el administrador). */
export async function saveDraftDefinition(
  db: SgcDb,
  idCompany: number,
  idFlowVersion: number,
  input: { definition: unknown; reason: unknown; changeReference?: unknown },
  actor: SgcActor
) {
  const reason = requireReason(input.reason);
  const changeReference = optionalReference(input.changeReference);
  const def = normalizeFlowDefinition(input.definition);
  return db.$transaction(async (tx) => {
    const version = await versionOfCompany(tx, idCompany, idFlowVersion);
    if (version.status !== 'borrador') throw new SgcError('Solo se edita una versión en borrador; cree una nueva versión para cambiar la vigente.', 409);
    await assertAuthorizationTypes(tx, idCompany, def);
    const before = await loadDefinition(tx, idFlowVersion);
    const changes = describeDefinitionChanges(before, def);
    await writeDefinitionRows(tx, idFlowVersion, def);
    await tx.sgcFlowVersion.update({ where: { id_flow_version: idFlowVersion }, data: { updated_at: new Date() } });
    await writeConfigChange(
      tx,
      { idCompany, entity: 'flow_version', entityId: idFlowVersion, idFlowProcess: version.id_flow_process, idFlowVersion, action: 'version.definicion_editada', reason, changeReference, before, after: { definition: def, cambios: changes } },
      actor
    );
    await writeSgcAudit(tx, { idCompany, actorEmail: actor.email, action: SGC_AUDIT_ACTIONS.flujoConfigurado, entity: 'flow_version', entityId: idFlowVersion, after: { cambios: changes }, detail: reason, ip: actor.ip, userAgent: actor.userAgent });
    return { changes, definition: def };
  }, TX_OPTS);
}

/**
 * Publica un BORRADOR: valida de nuevo la definición, deja retirada la
 * vigente anterior y marca esta como vigente (quién y cuándo). Las
 * solicitudes en curso siguen con su versión.
 */
export async function publishFlowVersion(db: SgcDb, idCompany: number, idFlowVersion: number, input: { reason: unknown; changeReference?: unknown }, actor: SgcActor) {
  const reason = requireReason(input.reason, 'El motivo de la publicación');
  const changeReference = optionalReference(input.changeReference);
  return db.$transaction(async (tx) => {
    const version = await versionOfCompany(tx, idCompany, idFlowVersion);
    if (version.status !== 'borrador') throw new SgcError('Solo se publica una versión en borrador.', 409);
    const def = normalizeFlowDefinition(await loadDefinition(tx, idFlowVersion));
    await assertAuthorizationTypes(tx, idCompany, def);
    const previous = await tx.sgcFlowVersion.findFirst({ where: { id_flow_process: version.id_flow_process, status: 'vigente' } });
    const now = new Date();
    if (previous) {
      await tx.sgcFlowVersion.update({ where: { id_flow_version: previous.id_flow_version }, data: { status: 'retirada', retired_at: now } });
    }
    await tx.sgcFlowVersion.update({ where: { id_flow_version: idFlowVersion }, data: { status: 'vigente', published_by: actor.email, published_at: now } });
    const beforeDef = previous ? await loadDefinition(tx, previous.id_flow_version) : null;
    const changes = describeDefinitionChanges(beforeDef, def);
    await writeConfigChange(
      tx,
      {
        idCompany,
        entity: 'flow_version',
        entityId: idFlowVersion,
        idFlowProcess: version.id_flow_process,
        idFlowVersion,
        action: 'version.publicada',
        reason,
        changeReference,
        before: previous ? { vigente: previous.version_number } : null,
        after: { vigente: version.version_number, cambios: changes },
      },
      actor
    );
    await writeSgcAudit(tx, { idCompany, actorEmail: actor.email, action: SGC_AUDIT_ACTIONS.flujoPublicado, entity: 'flow_version', entityId: idFlowVersion, before: previous ? { version: previous.version_number } : null, after: { version: version.version_number }, detail: reason, ip: actor.ip, userAgent: actor.userAgent });
    return { published: version.version_number, retired: previous?.version_number ?? null, changes };
  }, TX_OPTS);
}

/** Descarta un BORRADOR que nunca se publicó (queda la traza en el registro). */
export async function discardDraftVersion(db: SgcDb, idCompany: number, idFlowVersion: number, input: { reason: unknown }, actor: SgcActor) {
  const reason = requireReason(input.reason);
  return db.$transaction(async (tx) => {
    const version = await versionOfCompany(tx, idCompany, idFlowVersion);
    if (version.status !== 'borrador') throw new SgcError('Solo se descarta una versión en borrador.', 409);
    const before = await loadDefinition(tx, idFlowVersion);
    await tx.sgcFlowVersion.update({ where: { id_flow_version: idFlowVersion }, data: { status: 'retirada', retired_at: new Date() } });
    await writeConfigChange(tx, { idCompany, entity: 'flow_version', entityId: idFlowVersion, idFlowProcess: version.id_flow_process, idFlowVersion, action: 'version.borrador_descartado', reason, before }, actor);
    await writeSgcAudit(tx, { idCompany, actorEmail: actor.email, action: SGC_AUDIT_ACTIONS.flujoConfigurado, entity: 'flow_version', entityId: idFlowVersion, after: { descartado: true }, detail: reason, ip: actor.ip, userAgent: actor.userAgent });
    return { discarded: version.version_number };
  }, TX_OPTS);
}

/** Datos del proceso (nombre, descripción, activo). */
export async function updateFlowProcess(
  db: SgcDb,
  idCompany: number,
  idFlowProcess: number,
  input: { name?: unknown; description?: unknown; isActive?: unknown; reason: unknown; changeReference?: unknown },
  actor: SgcActor
) {
  const reason = requireReason(input.reason);
  const changeReference = optionalReference(input.changeReference);
  return db.$transaction(async (tx) => {
    const process = await tx.sgcFlowProcess.findUnique({ where: { id_flow_process: idFlowProcess } });
    if (!process || process.id_company !== idCompany) throw new SgcError('Flujo no encontrado.', 404);
    const data: { name?: string; description?: string | null; is_active?: boolean } = {};
    if (input.name !== undefined) {
      const name = typeof input.name === 'string' ? input.name.trim() : '';
      if (!name || name.length > 200) throw new SgcError('El nombre del flujo es obligatorio (máximo 200 caracteres).');
      data.name = name;
    }
    if (input.description !== undefined) data.description = typeof input.description === 'string' && input.description.trim() ? input.description.trim().slice(0, 1000) : null;
    if (input.isActive !== undefined) data.is_active = Boolean(input.isActive);
    const before = { name: process.name, description: process.description, isActive: process.is_active };
    const updated = await tx.sgcFlowProcess.update({ where: { id_flow_process: idFlowProcess }, data });
    const after = { name: updated.name, description: updated.description, isActive: updated.is_active };
    await writeConfigChange(tx, { idCompany, entity: 'flow_process', entityId: idFlowProcess, idFlowProcess, action: 'proceso.editado', reason, changeReference, before, after }, actor);
    await writeSgcAudit(tx, { idCompany, actorEmail: actor.email, action: SGC_AUDIT_ACTIONS.flujoConfigurado, entity: 'flow_process', entityId: idFlowProcess, before, after, detail: reason, ip: actor.ip, userAgent: actor.userAgent });
    return after;
  }, TX_OPTS);
}

export interface SgcConfigChangeRow {
  id: string;
  occurredAt: string;
  actorEmail: string;
  entity: string;
  entityId: string | null;
  idFlowProcess: number | null;
  idFlowVersion: number | null;
  action: string;
  reason: string;
  changeReference: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
}

function parseJson(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/** Registro de cambios de configuración (más recientes primero). */
export async function listConfigChanges(
  db: SgcDb,
  idCompany: number,
  opts: { idFlowProcess?: number | null; entity?: string | null; take?: number } = {}
): Promise<SgcConfigChangeRow[]> {
  const rows = await db.sgcConfigChangeLog.findMany({
    where: {
      id_company: idCompany,
      ...(opts.idFlowProcess ? { id_flow_process: opts.idFlowProcess } : {}),
      ...(opts.entity ? { entity: opts.entity } : {}),
    },
    orderBy: { id_config_change: 'desc' },
    take: Math.min(Math.max(opts.take ?? 200, 1), 500),
  });
  return rows.map((r) => ({
    id: r.id_config_change.toString(),
    occurredAt: r.occurred_at.toISOString(),
    actorEmail: r.actor_email,
    entity: r.entity,
    entityId: r.entity_id,
    idFlowProcess: r.id_flow_process,
    idFlowVersion: r.id_flow_version,
    action: r.action,
    reason: r.reason,
    changeReference: r.change_reference,
    before: parseJson(r.before_json),
    after: parseJson(r.after_json),
    ip: r.ip,
  }));
}
