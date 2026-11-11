/**
 * PERMISOS API — acceso a datos (mssql, consultas parametrizadas).
 *
 * Tablas: prisma/manual/2026-11-09-permisos-api-*.sql. Todo cambio de la
 * administración escribe en api_client_audit dentro de la MISMA transacción.
 * La llave en claro nunca llega aquí: solo su hash y su prefijo.
 */
import 'server-only';
import { sql, withMssqlPool } from '../mssqlPool';
import {
  API_CLIENT_SELECTABLE_TYPES,
  clientTypeUsesApiAccess,
  normalizeApiAccessMode,
  normalizePermissionAccessKind,
  permissionsForCopy,
  type ApiAccessMode,
  type ApiPermissionAccessKind,
} from './constants';
import type { ApiClientInput, ApiClientType } from './rules';

export interface ApiPermissionRow {
  code: string;
  system: string;
  groupLabel: string;
  label: string;
  description: string | null;
  active: boolean;
  displayOrder: number;
  /** 'escritura' = solo se puede marcar a clientes con nivel «escritura» (2026-11-11). */
  accessKind: ApiPermissionAccessKind;
}

export interface CompanyOption {
  id: number;
  name: string;
}

/** Agente de IA de SynerLink (tabla `agent`) que se puede elegir para un cliente tipo «agente». */
export interface AgentOption {
  code: string;
  name: string;
  description: string | null;
  active: boolean;
}

export interface ApiClientKeySummary {
  id: number;
  prefix: string;
  createdAt: string;
  createdBy: string;
  lastUsedAt: string | null;
  /** Cuándo vence (null = no vence). Una llave vencida sigue en la lista, marcada, hasta revocarla. */
  expiresAt: string | null;
}

export interface ApiClientSummary {
  id: number;
  name: string;
  clientType: ApiClientType;
  description: string | null;
  agentCode: string | null;
  /** Sujeto según el tipo (NIT, id de usuario o id de sistema) y su nombre visible. */
  subjectRef: string | null;
  subjectLabel: string | null;
  /** Nivel de acceso (NULL en la base = lectura). */
  accessMode: ApiAccessMode;
  allCompanies: boolean;
  companyIds: number[];
  permissionCodes: string[];
  /** Permisos limitados a algunas empresas (código → empresas). Lo que no está aquí vale en todas. */
  permissionCompanies: Record<string, number[]>;
  active: boolean;
  createdBy: string;
  createdAt: string;
  updatedBy: string | null;
  updatedAt: string | null;
  /** Solo llaves NO revocadas. */
  keys: ApiClientKeySummary[];
  /** Último uso de cualquiera de sus llaves (también revocadas). */
  lastUsedAt: string | null;
}

/** Lo que se autentica con una llave: cliente activo + llave no revocada. */
export interface ApiClientKeyRecord {
  keyId: number;
  keyHash: string;
  clientId: number;
  name: string;
  clientType: ApiClientType;
  agentCode: string | null;
  allCompanies: boolean;
  companyIds: number[];
  /** Solo permisos ACTIVOS del catálogo. */
  permissions: string[];
}

/** Error de «la tabla no existe» (falta correr el script del pase). */
/** Falta el script de permisos por empresa (2026-11-11-permisos-api-permiso-empresa-*.sql). */
export function isMissingPermissionCompanyTableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /api_client_permission_company/i.test(message) && /invalid object name|no es válido|nombre de objeto/i.test(message);
}

export function isMissingApiTablesError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /api_(client|permission)/i.test(message) && /invalid object name|no es válido|nombre de objeto/i.test(message);
}

/**
 * Falta el script de sujetos (2026-11-09-permisos-api-sujetos-*.sql): columnas
 * subject_ref / subject_label o la tabla api_external_system.
 */
export function isMissingSubjectsSchemaError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /subject_(ref|label)|api_external_system/i.test(message) &&
    /invalid (object|column) name|no es válido|nombre de (objeto|columna)/i.test(message)
  );
}

/** Falta el script del nivel de acceso (2026-11-11-permisos-api-nivel-acceso-*.sql): access_mode / access_kind. */
export function isMissingAccessLevelColumnError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /access_mode|access_kind/i.test(message) && /invalid column name|no es válido|nombre de columna/i.test(message);
}

/** Error de clave única (nombre de cliente repetido). */
export function isUniqueViolation(error: unknown): boolean {
  const number = (error as { number?: unknown })?.number;
  return number === 2627 || number === 2601;
}

/** Índice único del correo de México (prisma/manual/2026-11-10-permisos-api-correo-mexico-*.sql). */
export const MEXICO_SUBJECT_UNIQUE_INDEX = 'UX_api_client_mexico_subject';
export const MEXICO_EMAIL_TAKEN_MESSAGE = 'Ya existe un cliente de México con ese correo';
export const CLIENT_TYPE_RETIRED_MESSAGE = 'Ese tipo de cliente ya no se puede elegir';

/** Regla de negocio que el servidor rechaza al guardar (la ruta responde 409 con este mensaje). */
export class ApiClientConflictError extends Error {}

/** ¿El error de clave única viene del índice del correo de México? */
export function isMexicoEmailUniqueViolation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return isUniqueViolation(error) && message.includes(MEXICO_SUBJECT_UNIQUE_INDEX);
}

const iso = (value: Date | null | undefined): string | null => (value ? new Date(value).toISOString() : null);

type Queryable = { request(): sql.Request };

/* ─────────────────────────────── Catálogos ─────────────────────────────── */

export async function listPermissions(): Promise<ApiPermissionRow[]> {
  return withMssqlPool(async (pool) => {
    const r = await pool.request().query<{
      code: string;
      system: string;
      group_label: string;
      label: string;
      description: string | null;
      active: boolean;
      display_order: number;
      access_kind: string | null;
    }>(
      // access_kind exige el script 2026-11-11-permisos-api-nivel-acceso (si falta, la consulta falla).
      'SELECT code, [system], group_label, label, [description], active, display_order, access_kind FROM dbo.api_permission ORDER BY display_order, code'
    );
    return r.recordset.map((p) => ({
      code: p.code,
      system: p.system,
      groupLabel: p.group_label,
      label: p.label,
      description: p.description,
      active: Boolean(p.active),
      displayOrder: p.display_order,
      accessKind: normalizePermissionAccessKind(p.access_kind),
    }));
  });
}

export async function listCompanies(): Promise<CompanyOption[]> {
  return withMssqlPool(async (pool) => {
    const r = await pool.request().query<{ id_company: number; company: string }>(
      'SELECT id_company, company FROM dbo.company ORDER BY company'
    );
    return r.recordset.map((c) => ({ id: c.id_company, name: c.company }));
  });
}

/** Agentes de IA (activos primero) para elegirlos en la pantalla en vez de escribir el código. */
export async function listAgents(): Promise<AgentOption[]> {
  return withMssqlPool(async (pool) => {
    const r = await pool.request().query<{ code: string; display_name: string; description: string | null; is_active: boolean }>(
      'SELECT code, display_name, description, is_active FROM dbo.agent ORDER BY is_active DESC, sort_order, display_name'
    );
    return r.recordset.map((a) => ({
      code: a.code.toLowerCase(),
      name: a.display_name,
      description: a.description,
      active: Boolean(a.is_active),
    }));
  });
}

/** Si existe un agente con ese código (sin importar mayúsculas). */
export async function agentExists(code: string): Promise<boolean> {
  return withMssqlPool(async (pool) => {
    const r = await pool
      .request()
      .input('code', sql.NVarChar(60), code)
      .query<{ n: number }>('SELECT COUNT(*) AS n FROM dbo.agent WHERE LOWER(code) = LOWER(@code)');
    return (r.recordset[0]?.n ?? 0) > 0;
  });
}

/* ─────────────────────────────── Sujetos (2026-11-09) ─────────────────────────────── */

/** Usuario activo de SynerLink que se elige como sujeto de un cliente tipo «synerlink». */
export interface SynerlinkUserOption {
  id: string;
  name: string | null;
  email: string;
}

/** Escapa %, _ y [ para usar el texto dentro de LIKE ... ESCAPE '\'. */
function likePattern(text: string): string {
  return `%${text.replace(/[\\%_[]/g, (c) => `\\${c}`)}%`;
}

/** Hasta 20 usuarios ACTIVOS por nombre o correo (sin texto: los primeros 20 por nombre). */
export async function searchSynerlinkUsers(query: string): Promise<SynerlinkUserOption[]> {
  return withMssqlPool(async (pool) => {
    const r = await pool
      .request()
      .input('q', sql.NVarChar(60), query || null)
      .input('like', sql.NVarChar(200), query ? likePattern(query) : null)
      .query<{ id: string; name: string | null; email: string }>(`
        SELECT TOP 20 u.id, u.name, u.email
          FROM dbo.[user] u
         WHERE u.isActive = 1
           AND (@q IS NULL OR u.name LIKE @like ESCAPE '\\' OR u.email LIKE @like ESCAPE '\\')
         ORDER BY COALESCE(NULLIF(LTRIM(RTRIM(u.name)), N''), u.email)
      `);
    return r.recordset.map((u) => ({ id: u.id, name: u.name?.trim() || null, email: u.email }));
  });
}

/** El usuario si existe y está ACTIVO; null si no. */
export async function findActiveSynerlinkUser(id: string): Promise<SynerlinkUserOption | null> {
  return withMssqlPool(async (pool) => {
    const r = await pool
      .request()
      .input('id', sql.NVarChar(120), id)
      .query<{ id: string; name: string | null; email: string }>(
        'SELECT TOP 1 u.id, u.name, u.email FROM dbo.[user] u WHERE u.id = @id AND u.isActive = 1'
      );
    const u = r.recordset[0];
    return u ? { id: u.id, name: u.name?.trim() || null, email: u.email } : null;
  });
}

/** Sistema externo (tabla api_external_system) para clientes tipo «otro». */
export interface ExternalSystemRow {
  id: number;
  name: string;
  description: string | null;
  active: boolean;
  /** Cuántos clientes tipo «otro» lo usan como sujeto. */
  clientCount: number;
}

export async function listExternalSystems(): Promise<ExternalSystemRow[]> {
  return withMssqlPool(async (pool) => {
    const r = await pool.request().query<{
      id_api_external_system: number;
      name: string;
      description: string | null;
      active: boolean;
      client_count: number;
    }>(`
      SELECT s.id_api_external_system, s.name, s.[description], s.active,
             (SELECT COUNT(*) FROM dbo.api_client c
               WHERE c.client_type = N'otro' AND c.subject_ref = CAST(s.id_api_external_system AS NVARCHAR(20))) AS client_count
        FROM dbo.api_external_system s
       ORDER BY s.active DESC, s.name
    `);
    return r.recordset.map((x) => ({
      id: x.id_api_external_system,
      name: x.name,
      description: x.description,
      active: Boolean(x.active),
      clientCount: x.client_count,
    }));
  });
}

/** Nombre del sistema si existe y está ACTIVO; null si no. */
export async function findActiveExternalSystemName(id: number): Promise<string | null> {
  return withMssqlPool(async (pool) => {
    const r = await pool
      .request()
      .input('id', sql.Int, id)
      .query<{ name: string }>('SELECT name FROM dbo.api_external_system WHERE id_api_external_system = @id AND active = 1');
    return r.recordset[0]?.name ?? null;
  });
}

interface SystemRecord {
  name: string;
  description: string | null;
  active: boolean;
}

export async function createExternalSystem(input: SystemRecord, actor: string): Promise<number> {
  return inTransaction(async (tx) => {
    const r = await new sql.Request(tx)
      .input('name', sql.NVarChar(120), input.name)
      .input('description', sql.NVarChar(500), input.description)
      .input('active', sql.Bit, input.active)
      .input('actor', sql.NVarChar(320), actor)
      .query<{ id_api_external_system: number }>(`
        INSERT INTO dbo.api_external_system (name, [description], active, created_by)
        OUTPUT INSERTED.id_api_external_system
        VALUES (@name, @description, @active, @actor)
      `);
    const id = r.recordset[0].id_api_external_system;
    // Auditoría en api_client_audit sin cliente (id_api_client NULL): el detalle dice qué sistema.
    await writeAudit(tx, null, 'sistema_crear', { systemId: id, after: input }, actor);
    return id;
  });
}

/**
 * Edita un sistema (solo los campos enviados). Al renombrar, actualiza en la misma
 * transacción el subject_label de los clientes «otro» que lo usan. false = no existe.
 */
export async function updateExternalSystem(id: number, patch: Partial<SystemRecord>, actor: string): Promise<boolean> {
  return inTransaction(async (tx) => {
    const current = await new sql.Request(tx)
      .input('id', sql.Int, id)
      .query<{ name: string; description: string | null; active: boolean }>(
        'SELECT name, [description], active FROM dbo.api_external_system WITH (UPDLOCK) WHERE id_api_external_system = @id'
      );
    const row = current.recordset[0];
    if (!row) return false;
    const before: SystemRecord = { name: row.name, description: row.description, active: Boolean(row.active) };
    const after: SystemRecord = { ...before, ...patch };
    await new sql.Request(tx)
      .input('id', sql.Int, id)
      .input('name', sql.NVarChar(120), after.name)
      .input('description', sql.NVarChar(500), after.description)
      .input('active', sql.Bit, after.active)
      .input('actor', sql.NVarChar(320), actor)
      .query(`
        UPDATE dbo.api_external_system
           SET name = @name, [description] = @description, active = @active, updated_by = @actor, updated_at = SYSUTCDATETIME()
         WHERE id_api_external_system = @id
      `);
    if (after.name !== before.name) {
      await new sql.Request(tx)
        .input('ref', sql.NVarChar(120), String(id))
        .input('label', sql.NVarChar(200), after.name)
        .query(`UPDATE dbo.api_client SET subject_label = @label WHERE client_type = N'otro' AND subject_ref = @ref`);
    }
    await writeAudit(tx, null, 'sistema_editar', { systemId: id, before, after }, actor);
    return true;
  });
}

/* ─────────────────────────────── Clientes ─────────────────────────────── */

interface ClientRow {
  id_api_client: number;
  name: string;
  client_type: ApiClientType;
  description: string | null;
  agent_code: string | null;
  all_companies: boolean;
  active: boolean;
  created_by: string;
  created_at: Date;
  updated_by: string | null;
  updated_at: Date | null;
  subject_ref: string | null;
  subject_label: string | null;
  access_mode: string | null;
}

const CLIENT_COLUMNS =
  'c.id_api_client, c.name, c.client_type, c.[description], c.agent_code, c.all_companies, c.active, c.created_by, c.created_at, c.updated_by, c.updated_at, c.subject_ref, c.subject_label, c.access_mode';

/**
 * Lista los clientes; con `clientId`, solo ese (lo devuelven crear, editar y las llaves para que la
 * pantalla lo actualice sin recargar toda la lista: una petición menos por acción).
 */
export async function listApiClients(clientId: number | null = null): Promise<ApiClientSummary[]> {
  return withMssqlPool(async (pool) => {
    const req = () => pool.request().input('id', sql.Int, clientId);
    const [clients, companies, permissions, keys, permissionCompanies] = await Promise.all([
      req().query<ClientRow>(`SELECT ${CLIENT_COLUMNS} FROM dbo.api_client c WHERE (@id IS NULL OR c.id_api_client = @id) ORDER BY c.name`),
      req().query<{ id_api_client: number; id_company: number }>(
        'SELECT id_api_client, id_company FROM dbo.api_client_company WHERE (@id IS NULL OR id_api_client = @id)'
      ),
      req().query<{ id_api_client: number; permission_code: string }>(
        'SELECT id_api_client, permission_code FROM dbo.api_client_permission WHERE (@id IS NULL OR id_api_client = @id)'
      ),
      req().query<{
        id_api_client_key: number;
        id_api_client: number;
        key_prefix: string;
        created_by: string;
        created_at: Date;
        last_used_at: Date | null;
        revoked_at: Date | null;
        expires_at: Date | null;
      }>(
        // Columnas explícitas (nunca key_hash): exige el script de vencimiento 2026-11-10.
        `SELECT id_api_client_key, id_api_client, key_prefix, created_by, created_at, last_used_at, revoked_at, expires_at
           FROM dbo.api_client_key WHERE (@id IS NULL OR id_api_client = @id) ORDER BY created_at DESC`
      ),
      // Exige el script 2026-11-11-permisos-api-permiso-empresa (si falta la tabla, la consulta falla).
      req().query<{ id_api_client: number; permission_code: string; id_company: number }>(
        `SELECT id_api_client, permission_code, id_company FROM dbo.api_client_permission_company
          WHERE (@id IS NULL OR id_api_client = @id) ORDER BY id_company`
      ),
    ]);

    const byClient = new Map<number, ApiClientSummary>();
    for (const c of clients.recordset) {
      byClient.set(c.id_api_client, {
        ...toSnapshotBase(c),
        id: c.id_api_client,
        companyIds: [],
        permissionCodes: [],
        createdBy: c.created_by,
        createdAt: iso(c.created_at) ?? '',
        updatedBy: c.updated_by,
        updatedAt: iso(c.updated_at),
        keys: [],
        lastUsedAt: null,
        permissionCompanies: {},
      });
    }
    for (const row of companies.recordset) byClient.get(row.id_api_client)?.companyIds.push(row.id_company);
    for (const row of permissions.recordset) byClient.get(row.id_api_client)?.permissionCodes.push(row.permission_code);
    for (const row of permissionCompanies.recordset) {
      const client = byClient.get(row.id_api_client);
      if (!client) continue;
      (client.permissionCompanies[row.permission_code] ??= []).push(row.id_company);
    }
    for (const k of keys.recordset) {
      const client = byClient.get(k.id_api_client);
      if (!client) continue;
      const lastUsed = iso(k.last_used_at);
      if (lastUsed && (!client.lastUsedAt || lastUsed > client.lastUsedAt)) client.lastUsedAt = lastUsed;
      if (k.revoked_at) continue;
      client.keys.push({
        id: k.id_api_client_key,
        prefix: k.key_prefix,
        createdAt: iso(k.created_at) ?? '',
        createdBy: k.created_by,
        lastUsedAt: lastUsed,
        expiresAt: iso(k.expires_at),
      });
    }
    for (const client of byClient.values()) {
      client.companyIds.sort((a, b) => a - b);
      client.permissionCodes.sort();
    }
    return [...byClient.values()];
  });
}

/** Un cliente con sus llaves activas, en el mismo formato de la lista (null si no existe). */
export async function getApiClient(clientId: number): Promise<ApiClientSummary | null> {
  return (await listApiClients(clientId))[0] ?? null;
}

function toSnapshotBase(c: ClientRow) {
  return {
    name: c.name,
    clientType: c.client_type,
    description: c.description,
    agentCode: c.agent_code,
    allCompanies: Boolean(c.all_companies),
    active: Boolean(c.active),
    subjectRef: c.subject_ref,
    subjectLabel: c.subject_label,
    accessMode: normalizeApiAccessMode(c.access_mode),
  };
}

/** Estado de un cliente para la auditoría (sin llaves). */
async function readSnapshot(db: Queryable, clientId: number): Promise<ApiClientInput | null> {
  // Una sola ida a la base: cuatro conjuntos de resultados (cliente, empresas, permisos, permisos por empresa).
  const r = await db.request().input('id', sql.Int, clientId).query(`
    SELECT ${CLIENT_COLUMNS} FROM dbo.api_client c WHERE c.id_api_client = @id;
    SELECT id_company FROM dbo.api_client_company WHERE id_api_client = @id ORDER BY id_company;
    SELECT permission_code FROM dbo.api_client_permission WHERE id_api_client = @id ORDER BY permission_code;
    SELECT permission_code, id_company FROM dbo.api_client_permission_company WHERE id_api_client = @id ORDER BY permission_code, id_company;
  `);
  const sets = r.recordsets as unknown as [
    ClientRow[],
    { id_company: number }[],
    { permission_code: string }[],
    { permission_code: string; id_company: number }[],
  ];
  const c = sets[0][0];
  if (!c) return null;
  const permissionCompanies: Record<string, number[]> = {};
  for (const row of sets[3]) (permissionCompanies[row.permission_code] ??= []).push(row.id_company);
  return {
    ...toSnapshotBase(c),
    companyIds: sets[1].map((x) => x.id_company),
    permissionCodes: sets[2].map((x) => x.permission_code),
    permissionCompanies,
  };
}

/** Cuántos de los ids existen en dbo.company (los nombres de parámetro los genera el código). */
export async function countExistingCompanies(companyIds: number[]): Promise<number> {
  if (companyIds.length === 0) return 0;
  return withMssqlPool(async (pool) => {
    const request = pool.request();
    const names = companyIds.map((id, i) => {
      request.input(`c${i}`, sql.Int, id);
      return `@c${i}`;
    });
    const r = await request.query<{ n: number }>(`SELECT COUNT(*) AS n FROM dbo.company WHERE id_company IN (${names.join(', ')})`);
    return r.recordset[0]?.n ?? 0;
  });
}

async function writeAudit(tx: sql.Transaction, clientId: number | null, action: string, detail: unknown, actor: string): Promise<void> {
  await new sql.Request(tx)
    .input('id', sql.Int, clientId)
    .input('action', sql.NVarChar(40), action)
    .input('detail', sql.NVarChar(sql.MAX), JSON.stringify(detail))
    .input('actor', sql.NVarChar(320), actor)
    .query('INSERT INTO dbo.api_client_audit (id_api_client, [action], detail, changed_by) VALUES (@id, @action, @detail, @actor)');
}

/**
 * Reemplaza empresas y permisos en UNA ida a la base (2026-11-10): antes era un INSERT por fila
 * (51 permisos ≈ 0,5 s). Los nombres de parámetro los genera el código; los topes de
 * API_CLIENT_LIMITS (200 + 200) quedan muy lejos del máximo de SQL Server (2100 parámetros).
 */
async function replaceLinks(tx: sql.Transaction, clientId: number, input: ApiClientInput): Promise<void> {
  const request = new sql.Request(tx).input('id', sql.Int, clientId);
  const companyRows = input.companyIds.map((companyId, i) => {
    request.input(`c${i}`, sql.Int, companyId);
    return `(@id, @c${i})`;
  });
  const permissionRows = input.permissionCodes.map((code, i) => {
    request.input(`p${i}`, sql.NVarChar(100), code);
    return `(@id, @p${i})`;
  });
  // Permisos por empresa (2026-11-11): al borrar los permisos se borran solos (FK en cascada); se vuelven a poner.
  const restrictionRows: string[] = [];
  input.permissionCodes.forEach((code, i) => {
    for (const companyId of input.permissionCompanies[code] ?? []) {
      const n = restrictionRows.length;
      request.input(`r${n}`, sql.Int, companyId);
      restrictionRows.push(`(@id, @p${i}, @r${n})`);
    }
  });
  await request.query(`
    DELETE FROM dbo.api_client_company WHERE id_api_client = @id;
    DELETE FROM dbo.api_client_permission WHERE id_api_client = @id;
    ${companyRows.length ? `INSERT INTO dbo.api_client_company (id_api_client, id_company) VALUES ${companyRows.join(', ')};` : ''}
    ${permissionRows.length ? `INSERT INTO dbo.api_client_permission (id_api_client, permission_code) VALUES ${permissionRows.join(', ')};` : ''}
    ${restrictionRows.length ? `INSERT INTO dbo.api_client_permission_company (id_api_client, permission_code, id_company) VALUES ${restrictionRows.join(', ')};` : ''}
  `);
}

async function inTransaction<T>(fn: (tx: sql.Transaction) => Promise<T>): Promise<T> {
  return withMssqlPool(async (pool) => {
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      const result = await fn(tx);
      await tx.commit();
      return result;
    } catch (error) {
      try {
        await tx.rollback();
      } catch {
        /* el error original es el que importa */
      }
      throw error;
    }
  });
}

/**
 * Un correo de México = un cliente. El bloqueo (UPDLOCK, HOLDLOCK) evita que dos guardados
 * simultáneos pasen los dos; el índice único de la base es la última barrera.
 */
async function assertMexicoEmailFree(tx: sql.Transaction, input: ApiClientInput, clientId: number | null): Promise<void> {
  if (input.clientType !== 'mexico' || !input.subjectRef) return;
  const r = await new sql.Request(tx)
    .input('ref', sql.NVarChar(120), input.subjectRef)
    .input('id', sql.Int, clientId)
    .query<{ id_api_client: number }>(`
      SELECT TOP 1 id_api_client FROM dbo.api_client WITH (UPDLOCK, HOLDLOCK)
       WHERE client_type = N'mexico' AND subject_ref = @ref AND (@id IS NULL OR id_api_client <> @id)
    `);
  if (r.recordset.length > 0) throw new ApiClientConflictError(MEXICO_EMAIL_TAKEN_MESSAGE);
}

export async function createApiClient(input: ApiClientInput, actor: string): Promise<number> {
  // Tipos retirados (p. ej. «synerlink») no se crean aunque se llame la API directo.
  if (!API_CLIENT_SELECTABLE_TYPES.includes(input.clientType)) throw new ApiClientConflictError(CLIENT_TYPE_RETIRED_MESSAGE);
  return inTransaction(async (tx) => {
    await assertMexicoEmailFree(tx, input, null);
    const r = await new sql.Request(tx)
      .input('name', sql.NVarChar(120), input.name)
      .input('type', sql.NVarChar(30), input.clientType)
      .input('description', sql.NVarChar(500), input.description)
      .input('agentCode', sql.NVarChar(60), input.agentCode)
      .input('subjectRef', sql.NVarChar(120), input.subjectRef)
      .input('subjectLabel', sql.NVarChar(200), input.subjectLabel)
      .input('accessMode', sql.NVarChar(20), input.accessMode)
      .input('all', sql.Bit, input.allCompanies)
      .input('active', sql.Bit, input.active)
      .input('actor', sql.NVarChar(320), actor)
      .query<{ id_api_client: number }>(`
        INSERT INTO dbo.api_client (name, client_type, [description], agent_code, subject_ref, subject_label, access_mode, all_companies, active, created_by)
        OUTPUT INSERTED.id_api_client
        VALUES (@name, @type, @description, @agentCode, @subjectRef, @subjectLabel, @accessMode, @all, @active, @actor)
      `);
    const id = r.recordset[0].id_api_client;
    await replaceLinks(tx, id, input);
    await writeAudit(tx, id, 'crear', { after: input }, actor);
    return id;
  });
}

/** Devuelve false si el cliente no existe. */
export async function updateApiClient(clientId: number, input: ApiClientInput, actor: string): Promise<boolean> {
  return inTransaction(async (tx) => {
    const before = await readSnapshot(tx, clientId);
    if (!before) return false;
    // Un cliente viejo de tipo retirado se puede seguir editando, pero nadie pasa a ese tipo.
    if (!API_CLIENT_SELECTABLE_TYPES.includes(input.clientType) && before.clientType !== input.clientType) {
      throw new ApiClientConflictError(CLIENT_TYPE_RETIRED_MESSAGE);
    }
    await assertMexicoEmailFree(tx, input, clientId);
    await new sql.Request(tx)
      .input('id', sql.Int, clientId)
      .input('name', sql.NVarChar(120), input.name)
      .input('type', sql.NVarChar(30), input.clientType)
      .input('description', sql.NVarChar(500), input.description)
      .input('agentCode', sql.NVarChar(60), input.agentCode)
      .input('subjectRef', sql.NVarChar(120), input.subjectRef)
      .input('subjectLabel', sql.NVarChar(200), input.subjectLabel)
      .input('accessMode', sql.NVarChar(20), input.accessMode)
      .input('all', sql.Bit, input.allCompanies)
      .input('active', sql.Bit, input.active)
      .input('actor', sql.NVarChar(320), actor)
      .query(`
        UPDATE dbo.api_client
           SET name = @name, client_type = @type, [description] = @description, agent_code = @agentCode,
               subject_ref = @subjectRef, subject_label = @subjectLabel, access_mode = @accessMode,
               all_companies = @all, active = @active, updated_by = @actor, updated_at = SYSUTCDATETIME()
         WHERE id_api_client = @id
      `);
    await replaceLinks(tx, clientId, input);
    await writeAudit(tx, clientId, 'editar', { before, after: input }, actor);
    return true;
  });
}

/**
 * Elimina el cliente de API (2026-11-10): sus llaves, empresas y permisos se borran en cascada
 * (FK ON DELETE CASCADE). La auditoría se queda (api_client_audit no tiene FK) con la foto previa.
 * No toca al agente de IA ni el portal de proveedores. Devuelve false si el cliente no existe.
 */
export async function deleteApiClient(clientId: number, actor: string): Promise<boolean> {
  return inTransaction(async (tx) => {
    const before = await readSnapshot(tx, clientId);
    if (!before) return false;
    // Auditoría y borrado en una sola ida (el detalle suma cuántas llaves activas tenía).
    const r = await new sql.Request(tx)
      .input('id', sql.Int, clientId)
      .input('detail', sql.NVarChar(sql.MAX), JSON.stringify({ before }))
      .input('actor', sql.NVarChar(320), actor)
      .query(`
        DECLARE @activeKeys INT = (SELECT COUNT(*) FROM dbo.api_client_key WHERE id_api_client = @id AND revoked_at IS NULL);
        INSERT INTO dbo.api_client_audit (id_api_client, [action], detail, changed_by)
        VALUES (@id, N'eliminar', JSON_MODIFY(@detail, '$.activeKeys', @activeKeys), @actor);
        DELETE FROM dbo.api_client WHERE id_api_client = @id;
        SELECT @@ROWCOUNT AS deleted;
      `);
    return (r.recordset?.[0]?.deleted ?? 0) > 0;
  });
}

/* ─────────────────────────────── Copiar permisos (2026-11-11) ─────────────────────────────── */

export interface PermissionCopyOutcome {
  clientId: number;
  name: string;
  /** false = no se tocó (proveedor o cliente: no usa permisos de API). */
  applied: boolean;
  received: number;
  droppedWrite: number;
  droppedAgent: number;
  /** No se copiaron porque estaban limitados a empresas que este cliente no tiene. */
  droppedCompany: number;
}

export type CopyPermissionsResult =
  | { status: 'ok'; outcomes: PermissionCopyOutcome[] }
  | { status: 'source_not_found' }
  | { status: 'targets_not_found' };

/**
 * Pone a cada cliente destino los MISMOS permisos del origen (reemplaza los suyos), respetando las
 * reglas de cada destino (permissionsForCopy): nivel de acceso, agente y tipo. Todo en una
 * transacción, con auditoría 'copiar_permisos' por destino (antes / después / origen).
 */
export async function copyApiClientPermissions(sourceId: number, targetIds: number[], actor: string): Promise<CopyPermissionsResult> {
  return inTransaction(async (tx) => {
    const source = await readSnapshot(tx, sourceId);
    if (!source) return { status: 'source_not_found' };

    const kinds = await new sql.Request(tx).query<{ code: string; access_kind: string | null; active: boolean }>(
      'SELECT code, access_kind, active FROM dbo.api_permission'
    );
    const activeCodes = new Set(kinds.recordset.filter((k) => k.active).map((k) => k.code));
    const writeCodes = new Set(
      kinds.recordset.filter((k) => normalizePermissionAccessKind(k.access_kind) === 'escritura').map((k) => k.code)
    );
    const sourceCodes = source.permissionCodes.filter((c) => activeCodes.has(c));

    const outcomes: PermissionCopyOutcome[] = [];
    for (const targetId of targetIds) {
      const before = await readSnapshot(tx, targetId);
      if (!before) continue;
      const name = (await new sql.Request(tx).input('id', sql.Int, targetId).query<{ name: string }>(
        'SELECT name FROM dbo.api_client WITH (UPDLOCK) WHERE id_api_client = @id'
      )).recordset[0]?.name ?? '';
      const copy = permissionsForCopy(sourceCodes, before, writeCodes);
      if (before.clientType === 'portal_terceros') {
        outcomes.push({ clientId: targetId, name, applied: false, received: 0, droppedWrite: 0, droppedAgent: 0, droppedCompany: 0 });
        continue;
      }
      // Permisos por empresa: se conservan las empresas que el destino también tiene. Si no le queda
      // ninguna, ese permiso NO se copia (si no, pasaría a valer en todas sus empresas).
      const restrictions: Record<string, number[]> = {};
      const droppedCompany: string[] = [];
      const codes = copy.codes.filter((code) => {
        const limited = source.permissionCompanies[code];
        if (!limited) return true;
        const kept = before.allCompanies ? limited : limited.filter((id) => before.companyIds.includes(id));
        if (kept.length === 0) {
          droppedCompany.push(code);
          return false;
        }
        restrictions[code] = kept;
        return true;
      });
      await replaceLinks(tx, targetId, { ...before, permissionCodes: codes, permissionCompanies: restrictions });
      await new sql.Request(tx)
        .input('id', sql.Int, targetId)
        .input('actor', sql.NVarChar(320), actor)
        .query('UPDATE dbo.api_client SET updated_by = @actor, updated_at = SYSUTCDATETIME() WHERE id_api_client = @id');
      await writeAudit(
        tx,
        targetId,
        'copiar_permisos',
        {
          fromClientId: sourceId,
          before: { permissionCodes: before.permissionCodes, permissionCompanies: before.permissionCompanies },
          after: { permissionCodes: codes, permissionCompanies: restrictions },
          droppedWrite: copy.droppedWrite,
          droppedAgent: copy.droppedAgent,
          droppedCompany,
        },
        actor
      );
      outcomes.push({
        clientId: targetId,
        name,
        applied: true,
        received: codes.length,
        droppedWrite: copy.droppedWrite.length,
        droppedAgent: copy.droppedAgent.length,
        droppedCompany: droppedCompany.length,
      });
    }
    if (outcomes.length === 0) return { status: 'targets_not_found' };
    return { status: 'ok', outcomes };
  });
}

/* ─────────────────────────────── Llaves ─────────────────────────────── */

/** Tope de llaves activas por cliente (para rotar sin cortar el servicio caben dos o más). */
export const MAX_ACTIVE_KEYS_PER_CLIENT = 5;

export type CreateKeyResult =
  | { status: 'ok'; keyId: number; revokedKeyIds: number[] }
  | { status: 'not_found' }
  | { status: 'no_api_access' }
  | { status: 'too_many' };

/** ¿Falla porque aún no se corrió el script que agrega api_client_key.expires_at? */
export function isMissingKeyExpiryColumnError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /invalid column name 'expires_at'/i.test(message);
}

/**
 * Guarda una llave nueva (hash + prefijo). Con `rotate`, revoca en la misma
 * transacción todas las llaves activas del cliente. `validityYears` > 0 la hace
 * vencer en esos años (exige el script de vencimiento; con 0 no toca esa columna).
 */
export async function createApiClientKey(
  clientId: number,
  key: { hash: string; prefix: string },
  actor: string,
  rotate: boolean,
  validityYears = 0
): Promise<CreateKeyResult> {
  return inTransaction(async (tx) => {
    const exists = await new sql.Request(tx)
      .input('id', sql.Int, clientId)
      .query<{ active_keys: number; client_type: ApiClientType }>(`
        SELECT c.client_type,
               (SELECT COUNT(*) FROM dbo.api_client_key k WITH (UPDLOCK, HOLDLOCK)
                 WHERE k.id_api_client = c.id_api_client AND k.revoked_at IS NULL) AS active_keys
          FROM dbo.api_client c WITH (UPDLOCK)
         WHERE c.id_api_client = @id
      `);
    const row = exists.recordset[0];
    if (!row) return { status: 'not_found' };
    // «Proveedor o cliente» no se conecta por API: nunca lleva llave.
    if (!clientTypeUsesApiAccess(row.client_type)) return { status: 'no_api_access' };

    let revokedKeyIds: number[] = [];
    if (rotate) {
      const revoked = await new sql.Request(tx)
        .input('id', sql.Int, clientId)
        .input('actor', sql.NVarChar(320), actor)
        .query<{ id_api_client_key: number }>(`
          UPDATE dbo.api_client_key SET revoked_at = SYSUTCDATETIME(), revoked_by = @actor
          OUTPUT INSERTED.id_api_client_key
          WHERE id_api_client = @id AND revoked_at IS NULL
        `);
      revokedKeyIds = revoked.recordset.map((x) => x.id_api_client_key);
    } else if (row.active_keys >= MAX_ACTIVE_KEYS_PER_CLIENT) {
      return { status: 'too_many' };
    }

    const inserted = await new sql.Request(tx)
      .input('id', sql.Int, clientId)
      .input('hash', sql.Char(64), key.hash)
      .input('prefix', sql.NVarChar(20), key.prefix)
      .input('actor', sql.NVarChar(320), actor)
      .input('years', sql.Int, validityYears)
      .query<{ id_api_client_key: number }>(
        validityYears > 0
          ? `
        INSERT INTO dbo.api_client_key (id_api_client, key_hash, key_prefix, created_by, expires_at)
        OUTPUT INSERTED.id_api_client_key
        VALUES (@id, @hash, @prefix, @actor, DATEADD(YEAR, @years, SYSUTCDATETIME()))
      `
          : `
        INSERT INTO dbo.api_client_key (id_api_client, key_hash, key_prefix, created_by)
        OUTPUT INSERTED.id_api_client_key
        VALUES (@id, @hash, @prefix, @actor)
      `
      );
    const keyId = inserted.recordset[0].id_api_client_key;
    await writeAudit(
      tx,
      clientId,
      rotate ? 'rotar_llave' : 'generar_llave',
      { keyId, prefix: key.prefix, revokedKeyIds, validityYears },
      actor
    );
    return { status: 'ok', keyId, revokedKeyIds };
  });
}

/** Revoca una llave activa del cliente. Devuelve false si no existe o ya estaba revocada. */
export async function revokeApiClientKey(clientId: number, keyId: number, actor: string): Promise<boolean> {
  return inTransaction(async (tx) => {
    const r = await new sql.Request(tx)
      .input('id', sql.Int, clientId)
      .input('keyId', sql.Int, keyId)
      .input('actor', sql.NVarChar(320), actor)
      .query<{ key_prefix: string }>(`
        UPDATE dbo.api_client_key SET revoked_at = SYSUTCDATETIME(), revoked_by = @actor
        OUTPUT INSERTED.key_prefix
        WHERE id_api_client_key = @keyId AND id_api_client = @id AND revoked_at IS NULL
      `);
    const row = r.recordset[0];
    if (!row) return false;
    await writeAudit(tx, clientId, 'revocar_llave', { keyId, prefix: row.key_prefix }, actor);
    return true;
  });
}

/* ─────────────────────────────── Autenticación ─────────────────────────────── */

/**
 * Busca la llave por su hash (índice único). Solo devuelve llaves NO revocadas ni
 * vencidas, de clientes ACTIVOS de un tipo que se conecta por API; la comparación
 * final en tiempo constante la hace `authenticate.ts`.
 *
 * Todo se filtra en SQL y en UTC. Columnas explícitas: si falta expires_at (no se corrió
 * el script de vencimiento) la consulta FALLA y authenticate.ts niega el acceso.
 * Mismo criterio que mcp/src/dbKeys.ts (loadDbApiKeys).
 */
export async function findActiveKeyByHash(keyHash: string): Promise<ApiClientKeyRecord | null> {
  return withMssqlPool(async (pool) => {
    const r = await pool
      .request()
      .input('hash', sql.Char(64), keyHash)
      .query<{
        id_api_client_key: number;
        key_hash: string;
        id_api_client: number;
        name: string;
        client_type: ApiClientType;
        agent_code: string | null;
        all_companies: boolean;
      }>(`
        SELECT k.id_api_client_key, k.key_hash, k.id_api_client, c.name, c.client_type, c.agent_code, c.all_companies
          FROM dbo.api_client_key k
          INNER JOIN dbo.api_client c ON c.id_api_client = k.id_api_client
         WHERE k.key_hash = @hash
           AND k.revoked_at IS NULL
           AND (k.expires_at IS NULL OR k.expires_at > SYSUTCDATETIME())
           AND c.active = 1
           AND c.client_type <> N'portal_terceros'
      `);
    const row = r.recordset[0];
    if (!row) return null;
    const [companies, permissions] = await Promise.all([
      pool
        .request()
        .input('id', sql.Int, row.id_api_client)
        .query<{ id_company: number }>('SELECT id_company FROM dbo.api_client_company WHERE id_api_client = @id'),
      pool
        .request()
        .input('id', sql.Int, row.id_api_client)
        .query<{ permission_code: string }>(`
          SELECT cp.permission_code
            FROM dbo.api_client_permission cp
            INNER JOIN dbo.api_permission p ON p.code = cp.permission_code
           WHERE cp.id_api_client = @id AND p.active = 1
        `),
    ]);
    return {
      keyId: row.id_api_client_key,
      keyHash: row.key_hash,
      clientId: row.id_api_client,
      name: row.name,
      clientType: row.client_type,
      agentCode: row.agent_code,
      allCompanies: Boolean(row.all_companies),
      companyIds: companies.recordset.map((x) => x.id_company),
      permissions: permissions.recordset.map((x) => x.permission_code),
    };
  });
}

/** Marca el último uso; la condición de la consulta impide escribir más de una vez por minuto. */
export async function touchApiKeyLastUsed(keyId: number): Promise<void> {
  await withMssqlPool(async (pool) => {
    await pool
      .request()
      .input('id', sql.Int, keyId)
      .query(`
        UPDATE dbo.api_client_key SET last_used_at = SYSUTCDATETIME()
         WHERE id_api_client_key = @id
           AND (last_used_at IS NULL OR last_used_at < DATEADD(SECOND, -60, SYSUTCDATETIME()))
      `);
  });
}
