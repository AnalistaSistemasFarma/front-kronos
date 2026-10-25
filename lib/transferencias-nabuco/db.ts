import 'server-only';
import { sql, getPool } from '../mssqlPool';
import { DEFAULTS, LIMITES, NABUCO_JOB_TYPE, NABUCO_SOURCE_MODULE, esEntidadValida, type NabucoEstado } from './constants';
import { MAPEO_ENCABEZADO_DEFECTO, MAPEO_LINEAS_DEFECTO, validarMapeo, type FilaMapeo } from './mapeo';
import { cifrarSecreto } from './cifrado';
import type { EnvioPrevio } from './seleccion';

/**
 * Acceso a KRONOSDB del módulo (tablas nabuco_config / nabuco_envio y la tarea
 * del programador central). SIEMPRE parametrizado.
 */

export class NabucoError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'NabucoError';
    this.status = status;
  }
}

export interface NabucoConfig {
  id_config: number;
  id_company: number;
  nombre: string;
  activo: boolean;
  modo_simulacion: boolean;
  id_sap_endpoint: number | null;
  nabuco_url: string | null;
  nabuco_usuario: string | null;
  nabuco_password_enc: string | null;
  nabuco_org: string;
  ruta_token: string;
  ruta_solicitudes: string;
  timeout_ms: number;
  entidad_sap: string;
  filtro_odata: string | null;
  desde_fecha: string | null;
  lote_max: number;
  marcar_udf: boolean;
  udf_campo: string | null;
  udf_valor: string | null;
  clave_lineas: string;
  mapeo_encabezado: FilaMapeo[];
  mapeo_lineas: FilaMapeo[];
  max_reintentos: number;
  espera_reintento_min: number;
  alertas_correos: string[];
  alertar_fallo: boolean;
  alertar_sin_correr_min: number | null;
  ultima_alerta_sin_correr: Date | null;
  id_job: number | null;
  cron_expression: string | null;
  job_activo: boolean | null;
  last_run_date: Date | null;
  last_status: string | null;
}

/** Vista para el navegador: sin la contraseña (solo si está configurada). */
export type NabucoConfigPublica = Omit<NabucoConfig, 'nabuco_password_enc'> & { password_configurada: boolean };

export function configPublica(c: NabucoConfig): NabucoConfigPublica {
  const { nabuco_password_enc, ...resto } = c;
  return { ...resto, password_configurada: Boolean(nabuco_password_enc) };
}

function parseJsonArr(raw: unknown): FilaMapeo[] {
  try {
    const v = JSON.parse(String(raw ?? '[]'));
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function fechaIso(d: unknown): string | null {
  if (!d) return null;
  const x = d instanceof Date ? d : new Date(String(d));
  return Number.isNaN(x.getTime()) ? null : x.toISOString().slice(0, 10);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- fila cruda de mssql
function mapConfig(r: any): NabucoConfig {
  return {
    ...r,
    activo: Boolean(r.activo),
    modo_simulacion: Boolean(r.modo_simulacion),
    marcar_udf: Boolean(r.marcar_udf),
    alertar_fallo: Boolean(r.alertar_fallo),
    job_activo: r.job_activo === null || r.job_activo === undefined ? null : Boolean(r.job_activo),
    desde_fecha: fechaIso(r.desde_fecha),
    mapeo_encabezado: parseJsonArr(r.mapeo_encabezado),
    mapeo_lineas: parseJsonArr(r.mapeo_lineas),
    alertas_correos: String(r.alertas_correos ?? '')
      .split(/[;,\s]+/)
      .map((s: string) => s.trim())
      .filter(Boolean),
  };
}

const SELECT_CONFIG = `
  SELECT c.*, j.cron_expression, j.active AS job_activo, j.last_run_date, j.last_status
  FROM dbo.nabuco_config c
  LEFT JOIN dbo.scheduled_job j ON j.id = c.id_job`;

export async function listarConfigs(idCompany?: number): Promise<NabucoConfig[]> {
  const pool = await getPool();
  const req = pool.request();
  let q = SELECT_CONFIG;
  if (idCompany) {
    req.input('id_company', sql.Int, idCompany);
    q += ' WHERE c.id_company = @id_company';
  }
  const r = await req.query(`${q} ORDER BY c.nombre, c.id_config`);
  return r.recordset.map(mapConfig);
}

export async function obtenerConfig(idConfig: number): Promise<NabucoConfig | null> {
  const pool = await getPool();
  const r = await pool.request().input('id', sql.Int, idConfig).query(`${SELECT_CONFIG} WHERE c.id_config = @id`);
  return r.recordset[0] ? mapConfig(r.recordset[0]) : null;
}

function entero(v: unknown, def: number, lim: { min: number; max: number }, nombre: string): number {
  if (v === undefined || v === null || v === '') return def;
  const n = Number(v);
  if (!Number.isInteger(n) || n < lim.min || n > lim.max) throw new NabucoError(`${nombre} debe estar entre ${lim.min} y ${lim.max}.`);
  return n;
}

function texto(v: unknown, max: number, nombre: string): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (s.length > max) throw new NabucoError(`${nombre} supera ${max} caracteres.`);
  return s || null;
}

const CORREO_RE = /^[^\s@;,]+@[^\s@;,]+\.[^\s@;,]+$/;
const UDF_RE = /^U_[A-Za-z0-9_]{1,60}$/;
const RUTA_RE = /^\/[A-Za-z0-9_\-/.]{0,190}$/;

export interface EntradaConfig {
  nombre: string;
  activo: boolean;
  modo_simulacion: boolean;
  id_sap_endpoint: number | null;
  nabuco_url: string | null;
  nabuco_usuario: string | null;
  /** undefined = no cambiar; '' = no cambiar; texto = nueva contraseña. */
  nabuco_password?: string;
  nabuco_org: string;
  ruta_token: string;
  ruta_solicitudes: string;
  timeout_ms: number;
  entidad_sap: string;
  filtro_odata: string | null;
  desde_fecha: string | null;
  lote_max: number;
  marcar_udf: boolean;
  udf_campo: string | null;
  udf_valor: string | null;
  clave_lineas: string;
  mapeo_encabezado: FilaMapeo[];
  mapeo_lineas: FilaMapeo[];
  max_reintentos: number;
  espera_reintento_min: number;
  alertas_correos: string;
  alertar_fallo: boolean;
  alertar_sin_correr_min: number | null;
  cron_expression: string;
}

/** Valida y normaliza lo que manda el front (crear o editar). */
export function validarEntradaConfig(b: Record<string, unknown>, esNueva: boolean): EntradaConfig {
  const nombre = texto(b.nombre, 120, 'El nombre');
  if (!nombre) throw new NabucoError('El nombre de la configuración es obligatorio.');
  const nabuco_url = texto(b.nabuco_url, 500, 'La URL de Nabuco');
  if (nabuco_url) {
    let u: URL;
    try {
      u = new URL(nabuco_url);
    } catch {
      throw new NabucoError('La URL de Nabuco no es válida.');
    }
    if (u.protocol !== 'https:') throw new NabucoError('La URL de Nabuco debe ser https.');
  }
  const ruta_token = texto(b.ruta_token, 200, 'La ruta de token') ?? DEFAULTS.rutaToken;
  const ruta_solicitudes = texto(b.ruta_solicitudes, 200, 'La ruta de solicitudes') ?? DEFAULTS.rutaSolicitudes;
  if (!RUTA_RE.test(ruta_token) || !RUTA_RE.test(ruta_solicitudes)) throw new NabucoError('Las rutas de Nabuco deben empezar por «/» y no llevar espacios.');
  const entidad_sap = String(b.entidad_sap ?? DEFAULTS.entidad);
  if (!esEntidadValida(entidad_sap)) throw new NabucoError('Entidad SAP no válida.');
  const desde_fecha = texto(b.desde_fecha, 10, 'La fecha');
  if (desde_fecha && !/^\d{4}-\d{2}-\d{2}$/.test(desde_fecha)) throw new NabucoError('La fecha «enviar desde» debe tener formato AAAA-MM-DD.');
  const marcar_udf = Boolean(b.marcar_udf);
  const udf_campo = texto(b.udf_campo, 100, 'El campo UDF');
  const udf_valor = texto(b.udf_valor, 100, 'El valor UDF');
  if (marcar_udf && (!udf_campo || !UDF_RE.test(udf_campo) || !udf_valor)) throw new NabucoError('Para marcar el UDF indique un campo válido (U_...) y su valor.');
  const clave_lineas = texto(b.clave_lineas, 60, 'La clave de líneas') ?? DEFAULTS.claveLineas;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(clave_lineas)) throw new NabucoError('La clave de líneas no es válida.');
  const correos = String(b.alertas_correos ?? '')
    .split(/[;,\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  for (const c of correos) if (!CORREO_RE.test(c)) throw new NabucoError(`Correo de alerta no válido: ${c}`);
  const cron = texto(b.cron_expression, 100, 'La expresión cron') ?? DEFAULTS.cron;
  if (cron.split(/\s+/).length !== 5) throw new NabucoError('La expresión cron debe tener 5 campos.');
  const filtro = texto(b.filtro_odata, 1000, 'El filtro OData');
  if (filtro && /[\r\n&?#]/.test(filtro)) throw new NabucoError('El filtro OData no puede contener «&», «?», «#» ni saltos de línea.');
  let mapeo_encabezado: FilaMapeo[];
  let mapeo_lineas: FilaMapeo[];
  try {
    mapeo_encabezado = b.mapeo_encabezado === undefined && esNueva ? MAPEO_ENCABEZADO_DEFECTO : validarMapeo(b.mapeo_encabezado, 'encabezado');
    mapeo_lineas = b.mapeo_lineas === undefined && esNueva ? MAPEO_LINEAS_DEFECTO : validarMapeo(b.mapeo_lineas, 'líneas');
  } catch (e) {
    throw new NabucoError(e instanceof Error ? e.message : String(e));
  }
  const idEp = b.id_sap_endpoint === null || b.id_sap_endpoint === undefined || b.id_sap_endpoint === '' ? null : Number(b.id_sap_endpoint);
  if (idEp !== null && !Number.isInteger(idEp)) throw new NabucoError('Conexión SAP no válida.');
  const sinCorrer = b.alertar_sin_correr_min === null || b.alertar_sin_correr_min === undefined || b.alertar_sin_correr_min === '' ? null : entero(b.alertar_sin_correr_min, 60, { min: 5, max: 10080 }, 'Los minutos sin correr');
  return {
    nombre,
    activo: Boolean(b.activo),
    // Por defecto ENCENDIDO al crear.
    modo_simulacion: b.modo_simulacion === undefined ? true : Boolean(b.modo_simulacion),
    id_sap_endpoint: idEp,
    nabuco_url,
    nabuco_usuario: texto(b.nabuco_usuario, 200, 'El usuario de Nabuco'),
    nabuco_password: typeof b.nabuco_password === 'string' ? b.nabuco_password : undefined,
    nabuco_org: texto(b.nabuco_org, 20, 'La org') ?? DEFAULTS.org,
    ruta_token,
    ruta_solicitudes,
    timeout_ms: entero(b.timeout_ms, DEFAULTS.timeoutMs, LIMITES.timeoutMs, 'El timeout (ms)'),
    entidad_sap,
    filtro_odata: filtro,
    desde_fecha,
    lote_max: entero(b.lote_max, DEFAULTS.loteMax, LIMITES.loteMax, 'El lote máximo'),
    marcar_udf,
    udf_campo,
    udf_valor,
    clave_lineas,
    mapeo_encabezado,
    mapeo_lineas,
    max_reintentos: entero(b.max_reintentos, DEFAULTS.maxReintentos, LIMITES.maxReintentos, 'El máximo de reintentos'),
    espera_reintento_min: entero(b.espera_reintento_min, DEFAULTS.esperaReintentoMin, LIMITES.esperaReintentoMin, 'La espera entre reintentos'),
    alertas_correos: correos.join(';'),
    alertar_fallo: b.alertar_fallo === undefined ? true : Boolean(b.alertar_fallo),
    alertar_sin_correr_min: sinCorrer,
    cron_expression: cron,
  };
}

function inputsConfig(req: ReturnType<sql.ConnectionPool['request']>, e: EntradaConfig) {
  return req
    .input('nombre', sql.NVarChar(120), e.nombre)
    .input('activo', sql.Bit, e.activo)
    .input('modo_simulacion', sql.Bit, e.modo_simulacion)
    .input('id_sap_endpoint', sql.Int, e.id_sap_endpoint)
    .input('nabuco_url', sql.NVarChar(500), e.nabuco_url)
    .input('nabuco_usuario', sql.NVarChar(200), e.nabuco_usuario)
    .input('nabuco_org', sql.NVarChar(20), e.nabuco_org)
    .input('ruta_token', sql.NVarChar(200), e.ruta_token)
    .input('ruta_solicitudes', sql.NVarChar(200), e.ruta_solicitudes)
    .input('timeout_ms', sql.Int, e.timeout_ms)
    .input('entidad_sap', sql.NVarChar(60), e.entidad_sap)
    .input('filtro_odata', sql.NVarChar(1000), e.filtro_odata)
    .input('desde_fecha', sql.Date, e.desde_fecha)
    .input('lote_max', sql.Int, e.lote_max)
    .input('marcar_udf', sql.Bit, e.marcar_udf)
    .input('udf_campo', sql.NVarChar(100), e.udf_campo)
    .input('udf_valor', sql.NVarChar(100), e.udf_valor)
    .input('clave_lineas', sql.NVarChar(60), e.clave_lineas)
    .input('mapeo_encabezado', sql.NVarChar(sql.MAX), JSON.stringify(e.mapeo_encabezado))
    .input('mapeo_lineas', sql.NVarChar(sql.MAX), JSON.stringify(e.mapeo_lineas))
    .input('max_reintentos', sql.Int, e.max_reintentos)
    .input('espera_reintento_min', sql.Int, e.espera_reintento_min)
    .input('alertas_correos', sql.NVarChar(1000), e.alertas_correos || null)
    .input('alertar_fallo', sql.Bit, e.alertar_fallo)
    .input('alertar_sin_correr_min', sql.Int, e.alertar_sin_correr_min);
}

/**
 * Crea la configuración y su tarea «nabuco_transferir» en scheduled_job (payload { id_config }).
 * `nextRun` lo calcula el llamador con el runner (valida el cron).
 */
export async function crearConfig(idCompany: number, e: EntradaConfig, actor: string, nextRun: Date): Promise<number> {
  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const passEnc = e.nabuco_password ? cifrarSecreto(e.nabuco_password) : null;
    const ins = await inputsConfig(tx.request(), e)
      .input('id_company', sql.Int, idCompany)
      .input('pass', sql.NVarChar(1000), passEnc)
      .input('actor', sql.NVarChar(255), actor)
      .query(`
        INSERT INTO dbo.nabuco_config (id_company, nombre, activo, modo_simulacion, id_sap_endpoint, nabuco_url, nabuco_usuario,
          nabuco_password_enc, nabuco_org, ruta_token, ruta_solicitudes, timeout_ms, entidad_sap, filtro_odata, desde_fecha, lote_max,
          marcar_udf, udf_campo, udf_valor, clave_lineas, mapeo_encabezado, mapeo_lineas, max_reintentos, espera_reintento_min,
          alertas_correos, alertar_fallo, alertar_sin_correr_min, created_by)
        OUTPUT INSERTED.id_config
        VALUES (@id_company, @nombre, @activo, @modo_simulacion, @id_sap_endpoint, @nabuco_url, @nabuco_usuario,
          @pass, @nabuco_org, @ruta_token, @ruta_solicitudes, @timeout_ms, @entidad_sap, @filtro_odata, @desde_fecha, @lote_max,
          @marcar_udf, @udf_campo, @udf_valor, @clave_lineas, @mapeo_encabezado, @mapeo_lineas, @max_reintentos, @espera_reintento_min,
          @alertas_correos, @alertar_fallo, @alertar_sin_correr_min, @actor)`);
    const idConfig = ins.recordset[0].id_config as number;
    const job = await tx
      .request()
      .input('name', sql.NVarChar(255), `Transferencias Nabuco · ${e.nombre}`.slice(0, 255))
      .input('job_type', sql.NVarChar(50), NABUCO_JOB_TYPE)
      .input('payload', sql.NVarChar(sql.MAX), JSON.stringify({ id_config: idConfig }))
      .input('cron', sql.NVarChar(100), e.cron_expression)
      .input('next', sql.DateTime, nextRun)
      .input('active', sql.Bit, e.activo)
      .input('src', sql.NVarChar(100), NABUCO_SOURCE_MODULE)
      .input('actor', sql.NVarChar(255), actor)
      .query(`
        INSERT INTO dbo.scheduled_job (name, job_type, payload, cron_expression, next_run_date, active, source_module, created_by)
        OUTPUT INSERTED.id
        VALUES (@name, @job_type, @payload, @cron, @next, @active, @src, @actor)`);
    await tx.request().input('id', sql.Int, idConfig).input('job', sql.Int, job.recordset[0].id).query('UPDATE dbo.nabuco_config SET id_job = @job WHERE id_config = @id');
    await tx.commit();
    return idConfig;
  } catch (err) {
    await tx.rollback().catch(() => undefined);
    throw err;
  }
}

export async function actualizarConfig(actual: NabucoConfig, e: EntradaConfig, actor: string, nextRun: Date): Promise<void> {
  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const req = inputsConfig(tx.request(), e).input('id', sql.Int, actual.id_config).input('actor', sql.NVarChar(255), actor);
    let setPass = '';
    if (e.nabuco_password) {
      req.input('pass', sql.NVarChar(1000), cifrarSecreto(e.nabuco_password));
      setPass = 'nabuco_password_enc = @pass,';
    }
    await req.query(`
      UPDATE dbo.nabuco_config SET ${setPass}
        nombre = @nombre, activo = @activo, modo_simulacion = @modo_simulacion, id_sap_endpoint = @id_sap_endpoint,
        nabuco_url = @nabuco_url, nabuco_usuario = @nabuco_usuario, nabuco_org = @nabuco_org, ruta_token = @ruta_token,
        ruta_solicitudes = @ruta_solicitudes, timeout_ms = @timeout_ms, entidad_sap = @entidad_sap, filtro_odata = @filtro_odata,
        desde_fecha = @desde_fecha, lote_max = @lote_max, marcar_udf = @marcar_udf, udf_campo = @udf_campo, udf_valor = @udf_valor,
        clave_lineas = @clave_lineas, mapeo_encabezado = @mapeo_encabezado, mapeo_lineas = @mapeo_lineas,
        max_reintentos = @max_reintentos, espera_reintento_min = @espera_reintento_min, alertas_correos = @alertas_correos,
        alertar_fallo = @alertar_fallo, alertar_sin_correr_min = @alertar_sin_correr_min, updated_by = @actor, updated_at = SYSDATETIME()
      WHERE id_config = @id`);
    if (actual.id_job) {
      await tx
        .request()
        .input('id', sql.Int, actual.id_job)
        .input('name', sql.NVarChar(255), `Transferencias Nabuco · ${e.nombre}`.slice(0, 255))
        .input('cron', sql.NVarChar(100), e.cron_expression)
        .input('next', sql.DateTime, nextRun)
        .input('active', sql.Bit, e.activo)
        .query(`
          UPDATE dbo.scheduled_job SET name = @name, active = @active, cron_expression = @cron,
            next_run_date = CASE WHEN cron_expression = @cron AND next_run_date IS NOT NULL THEN next_run_date ELSE @next END
          WHERE id = @id`);
    }
    await tx.commit();
  } catch (err) {
    await tx.rollback().catch(() => undefined);
    throw err;
  }
}

/* ---------------- Lock por configuración ---------------- */

/** Toma el lock de corrida (UPDATE condicional). false = otra corrida está en curso. */
export async function tomarLock(idConfig: number): Promise<boolean> {
  const pool = await getPool();
  const r = await pool
    .request()
    .input('id', sql.Int, idConfig)
    .input('min', sql.Int, LIMITES.lockMinutos)
    .query(`
      UPDATE dbo.nabuco_config SET en_ejecucion_desde = SYSDATETIME()
      WHERE id_config = @id AND (en_ejecucion_desde IS NULL OR en_ejecucion_desde < DATEADD(MINUTE, -@min, SYSDATETIME()))`);
  return r.rowsAffected[0] === 1;
}

export async function soltarLock(idConfig: number): Promise<void> {
  const pool = await getPool();
  await pool.request().input('id', sql.Int, idConfig).query('UPDATE dbo.nabuco_config SET en_ejecucion_desde = NULL WHERE id_config = @id');
}

/* ---------------- Envíos ---------------- */

export async function enviosPrevios(idCompany: number, entidad: string, docEntries: number[]): Promise<EnvioPrevio[]> {
  if (!docEntries.length) return [];
  const pool = await getPool();
  const out: EnvioPrevio[] = [];
  // En bloques: los DocEntry son enteros validados; van como TVP-lite por JSON (parametrizado).
  for (let i = 0; i < docEntries.length; i += 1000) {
    const bloque = docEntries.slice(i, i + 1000).filter((n) => Number.isInteger(n));
    const r = await pool
      .request()
      .input('id_company', sql.Int, idCompany)
      .input('entidad', sql.NVarChar(60), entidad)
      .input('docs', sql.NVarChar(sql.MAX), JSON.stringify(bloque))
      .query(`
        SELECT e.doc_entry, e.estado, e.intentos, e.proximo_intento
        FROM dbo.nabuco_envio e
        JOIN OPENJSON(@docs) d ON CAST(d.value AS INT) = e.doc_entry
        WHERE e.id_company = @id_company AND e.entidad = @entidad`);
    out.push(...(r.recordset as EnvioPrevio[]));
  }
  return out;
}

export interface ResultadoEnvio {
  estado: NabucoEstado;
  payload: string | null;
  respuesta: string | null;
  http_status: number | null;
  error: string | null;
  /** Minutos para el próximo intento (solo en error con reintentos disponibles). */
  proximoEnMin: number | null;
  /** Suma un intento (no en simulación). */
  cuentaIntento: boolean;
}

/**
 * Registra el resultado de un documento (MERGE por empresa+entidad+DocEntry). Nunca pisa
 * un 'enviado': la condición del UPDATE lo protege aunque dos corridas coincidan.
 * Devuelve el número de intentos acumulado y el id del envío.
 */
export async function registrarResultado(
  cfg: { id_config: number; id_company: number; entidad_sap: string },
  doc: { DocEntry: number; DocNum?: number | null },
  r: ResultadoEnvio,
  usuario: string | null = null
): Promise<{ id_envio: number; intentos: number } | null> {
  const pool = await getPool();
  const q = await pool
    .request()
    .input('id_config', sql.Int, cfg.id_config)
    .input('id_company', sql.Int, cfg.id_company)
    .input('entidad', sql.NVarChar(60), cfg.entidad_sap)
    .input('doc_entry', sql.Int, doc.DocEntry)
    .input('doc_num', sql.Int, doc.DocNum ?? null)
    .input('estado', sql.NVarChar(20), r.estado)
    .input('payload', sql.NVarChar(sql.MAX), r.payload)
    .input('respuesta', sql.NVarChar(sql.MAX), r.respuesta)
    .input('http_status', sql.Int, r.http_status)
    .input('error', sql.NVarChar(2000), r.error ? r.error.slice(0, 2000) : null)
    .input('inc', sql.Int, r.cuentaIntento ? 1 : 0)
    .input('prox', sql.Int, r.proximoEnMin)
    .input('usuario', sql.NVarChar(255), usuario)
    .query(`
      SET XACT_ABORT ON;
      BEGIN TRAN;
      IF NOT EXISTS (SELECT 1 FROM dbo.nabuco_envio WITH (UPDLOCK, HOLDLOCK) WHERE id_company = @id_company AND entidad = @entidad AND doc_entry = @doc_entry)
        INSERT INTO dbo.nabuco_envio (id_config, id_company, entidad, doc_entry, doc_num, estado)
        VALUES (@id_config, @id_company, @entidad, @doc_entry, @doc_num, N'pendiente');
      UPDATE dbo.nabuco_envio SET
        id_config = @id_config, doc_num = COALESCE(@doc_num, doc_num), estado = @estado, intentos = intentos + @inc,
        payload = @payload, respuesta = @respuesta, http_status = @http_status, error = @error,
        ultimo_intento = SYSDATETIME(),
        proximo_intento = CASE WHEN @prox IS NULL THEN NULL ELSE DATEADD(MINUTE, @prox, SYSDATETIME()) END,
        enviado_en = CASE WHEN @estado = N'enviado' THEN SYSDATETIME() ELSE enviado_en END,
        usuario_accion = COALESCE(@usuario, usuario_accion), fecha_accion = CASE WHEN @usuario IS NULL THEN fecha_accion ELSE SYSDATETIME() END
      OUTPUT INSERTED.id_envio, INSERTED.intentos
      WHERE id_company = @id_company AND entidad = @entidad AND doc_entry = @doc_entry AND estado <> N'enviado';
      COMMIT TRAN;`);
  const row = q.recordset?.[0];
  return row ? { id_envio: Number(row.id_envio), intentos: row.intentos } : null;
}

export async function marcarAlertaEnviada(idEnvio: number): Promise<void> {
  const pool = await getPool();
  await pool.request().input('id', sql.BigInt, idEnvio).query('UPDATE dbo.nabuco_envio SET alerta_enviada = 1 WHERE id_envio = @id');
}

export interface FiltroEnvios {
  idCompany: number;
  idConfig?: number | null;
  estado?: string | null;
  desde?: string | null;
  hasta?: string | null;
  docNum?: number | null;
}

export async function listarEnvios(f: FiltroEnvios, limite = 200) {
  const pool = await getPool();
  const req = pool.request().input('id_company', sql.Int, f.idCompany).input('lim', sql.Int, limite);
  const w = ['e.id_company = @id_company'];
  if (f.idConfig) {
    req.input('id_config', sql.Int, f.idConfig);
    w.push('e.id_config = @id_config');
  }
  if (f.estado) {
    req.input('estado', sql.NVarChar(20), f.estado);
    w.push('e.estado = @estado');
  }
  if (f.desde) {
    req.input('desde', sql.Date, f.desde);
    w.push('e.creado >= @desde');
  }
  if (f.hasta) {
    req.input('hasta', sql.Date, f.hasta);
    w.push('e.creado < DATEADD(DAY, 1, CAST(@hasta AS DATETIME2))');
  }
  if (f.docNum) {
    req.input('doc_num', sql.Int, f.docNum);
    w.push('e.doc_num = @doc_num');
  }
  const r = await req.query(`
    SELECT TOP (@lim) e.id_envio, e.id_config, c.nombre AS config_nombre, e.entidad, e.doc_entry, e.doc_num, e.estado, e.intentos,
      e.http_status, LEFT(e.error, 300) AS error, e.creado, e.ultimo_intento, e.proximo_intento, e.enviado_en, e.usuario_accion, e.fecha_accion
    FROM dbo.nabuco_envio e JOIN dbo.nabuco_config c ON c.id_config = e.id_config
    WHERE ${w.join(' AND ')}
    ORDER BY COALESCE(e.ultimo_intento, e.creado) DESC`);
  return r.recordset;
}

export async function obtenerEnvio(idEnvio: number) {
  const pool = await getPool();
  const r = await pool.request().input('id', sql.BigInt, idEnvio).query(`
    SELECT e.*, c.nombre AS config_nombre FROM dbo.nabuco_envio e JOIN dbo.nabuco_config c ON c.id_config = e.id_config WHERE e.id_envio = @id`);
  return r.recordset[0] ?? null;
}

/** Descarta (no se vuelve a intentar) o reprograma un reintento inmediato. Nunca toca un 'enviado'. */
export async function accionManualEnvio(idEnvio: number, accion: 'descartar' | 'reintentar', usuario: string): Promise<boolean> {
  const pool = await getPool();
  const r = await pool
    .request()
    .input('id', sql.BigInt, idEnvio)
    .input('usuario', sql.NVarChar(255), usuario)
    .query(
      accion === 'descartar'
        ? `UPDATE dbo.nabuco_envio SET estado = N'descartado', proximo_intento = NULL, usuario_accion = @usuario, fecha_accion = SYSDATETIME()
           WHERE id_envio = @id AND estado <> N'enviado'`
        : `UPDATE dbo.nabuco_envio SET estado = N'pendiente', intentos = 0, alerta_enviada = 0, proximo_intento = NULL, usuario_accion = @usuario, fecha_accion = SYSDATETIME()
           WHERE id_envio = @id AND estado IN (N'error', N'descartado', N'simulado', N'pendiente')`
    );
  return r.rowsAffected[0] === 1;
}

/** KPIs del tablero: hoy y últimos 7 días por estado. */
export async function kpis(idCompany: number, idConfig?: number | null) {
  const pool = await getPool();
  const req = pool.request().input('id_company', sql.Int, idCompany);
  let extra = '';
  if (idConfig) {
    req.input('id_config', sql.Int, idConfig);
    extra = ' AND id_config = @id_config';
  }
  const r = await req.query(`
    SELECT estado,
      SUM(CASE WHEN COALESCE(ultimo_intento, creado) >= CAST(CAST(SYSDATETIME() AS DATE) AS DATETIME2) THEN 1 ELSE 0 END) AS hoy,
      SUM(CASE WHEN COALESCE(ultimo_intento, creado) >= DATEADD(DAY, -7, SYSDATETIME()) THEN 1 ELSE 0 END) AS semana,
      COUNT(*) AS total
    FROM dbo.nabuco_envio WHERE id_company = @id_company${extra}
    GROUP BY estado`);
  return r.recordset as { estado: NabucoEstado; hoy: number; semana: number; total: number }[];
}

/** Historial de corridas (scheduled_job_run) de las tareas de las configs de la empresa. */
export async function listarCorridas(idCompany: number, limite = 100) {
  const pool = await getPool();
  const r = await pool.request().input('id_company', sql.Int, idCompany).input('lim', sql.Int, limite).query(`
    SELECT TOP (@lim) r.id, r.id_job, c.id_config, c.nombre AS config_nombre, r.status, r.detail, r.result_ref, r.run_at
    FROM dbo.scheduled_job_run r
    JOIN dbo.nabuco_config c ON c.id_job = r.id_job
    WHERE c.id_company = @id_company
    ORDER BY r.id DESC`);
  return r.recordset;
}

/** Registra una corrida manual («Ejecutar ahora») en scheduled_job_run, igual que el runner. */
export async function registrarCorridaManual(idJob: number, status: 'ok' | 'error', detail: string, ref: string | null): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input('id_job', sql.Int, idJob)
    .input('status', sql.NVarChar(20), status)
    .input('detail', sql.NVarChar(1000), detail.slice(0, 1000))
    .input('ref', sql.NVarChar(255), ref ? ref.slice(0, 255) : null)
    .query(`
      INSERT INTO scheduled_job_run (id_job, status, detail, result_ref) VALUES (@id_job, @status, @detail, @ref);
      UPDATE scheduled_job SET last_run_date = GETDATE(), last_status = @status WHERE id = @id_job;`);
}

export async function marcarAlertaSinCorrer(idConfig: number): Promise<void> {
  const pool = await getPool();
  await pool.request().input('id', sql.Int, idConfig).query('UPDATE dbo.nabuco_config SET ultima_alerta_sin_correr = SYSDATETIME() WHERE id_config = @id');
}

/** Documentos de la config que siguen pendientes o en error (para reintentarlos aunque ya no salgan en la consulta de SAP). */
export async function pendientesDeConfig(idConfig: number, limite = 500): Promise<{ DocEntry: number; DocNum: number | null }[]> {
  const pool = await getPool();
  const r = await pool.request().input('id', sql.Int, idConfig).input('lim', sql.Int, limite).query(`
    SELECT TOP (@lim) doc_entry AS DocEntry, doc_num AS DocNum FROM dbo.nabuco_envio
    WHERE id_config = @id AND estado IN (N'pendiente', N'error') ORDER BY doc_entry`);
  return r.recordset;
}
