/**
 * Ejecución en KRONOSDB_PRUEBAS para el conector «kronos-pruebas-sql» (ver
 * pruebas-sql.mjs para las guardas de texto). Aquí van las guardas del
 * SERVIDOR, que no dependen del texto:
 *
 *   - Cada llamada abre SU conexión (pool de 1) con database=KRONOSDB_PRUEBAS y
 *     la cierra al terminar. Verifica DB_NAME() al conectar: si no es la base de
 *     pruebas, aborta sin correr nada.
 *   - Se suplanta (EXECUTE AS USER … WITH NO REVERT) a un usuario SIN LOGIN de
 *     KRONOSDB_PRUEBAS: lectura (db_datareader) para consultar, escritura
 *     (datareader + datawriter + ddladmin + EXECUTE) para ejecutar y scripts.
 *     Con la base NO TRUSTWORTHY, esa suplantación no puede salir de la base:
 *     SQL Server niega cualquier otra (KRONOSDB incluida), aunque el login de
 *     la conexión sí tenga acceso a ellas.
 *   - Antes de CADA lote se verifica otra vez DB_NAME() y USER_NAME().
 *   - Tiempo máximo por lote (requestTimeout) y tope de filas devueltas.
 *
 * `driver` se inyecta (mssql real o un doble en las pruebas).
 */
import { BASE_PRUEBAS, ErrorGuarda, FILAS_DEFECTO, MAX_FILAS, USUARIO_ESCRITURA, USUARIO_LECTURA } from './pruebas-sql.mjs';

export const TIMEOUT_CONSULTA_MS = 60_000;
export const TIMEOUT_ESCRITURA_MS = 120_000;
const MAX_CELDA = 2000;

/** Configuración de mssql desde el secreto (sin imprimirlo). La base es SIEMPRE la de pruebas. */
export function configMssql(sec, requestTimeout) {
  if (!sec || typeof sec !== 'object') throw new Error('falta la configuración SQL de pruebas');
  for (const k of ['server', 'user', 'password']) if (typeof sec[k] !== 'string' || !sec[k]) throw new Error(`la configuración SQL de pruebas no trae ${k}`);
  if (sec.database && String(sec.database).toUpperCase() !== BASE_PRUEBAS) throw new Error('la configuración SQL no apunta a KRONOSDB_PRUEBAS: no se conecta');
  return {
    server: sec.server,
    port: Number(sec.port ?? 1433),
    database: BASE_PRUEBAS,
    user: sec.user,
    password: sec.password,
    connectionTimeout: 15_000,
    requestTimeout,
    pool: { max: 1, min: 0, idleTimeoutMillis: 5_000 },
    options: { encrypt: String(sec.encrypt) === 'true', trustServerCertificate: true, appName: 'puente-hilos-pruebas', enableArithAbort: true },
  };
}

/** Recorta celdas largas y binarios para devolverlos al modelo. */
export function celda(v) {
  if (v === null || v === undefined) return null;
  if (Buffer.isBuffer(v)) return `<binario ${v.length} B>`;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') return v.length > MAX_CELDA ? `${v.slice(0, MAX_CELDA)}… (${v.length} caracteres)` : v;
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'object') return celda(JSON.stringify(v));
  return v;
}

/**
 * Abre la sesión: conecta, verifica la base, se suplanta y verifica de nuevo.
 * Devuelve { pool, verificar, cerrar }. Lanza si algo no cuadra (y cierra).
 */
export async function abrirSesion({ driver, sec, modo, timeoutMs }) {
  const usuario = modo === 'consultar' ? USUARIO_LECTURA : USUARIO_ESCRITURA;
  const pool = new driver.ConnectionPool(configMssql(sec, timeoutMs));
  await pool.connect();
  const cerrar = async () => {
    try {
      await pool.close();
    } catch {}
  };
  try {
    const r0 = await pool.request().query('SELECT DB_NAME() AS db');
    const db0 = r0?.recordset?.[0]?.db;
    if (String(db0).toUpperCase() !== BASE_PRUEBAS) throw new ErrorGuarda(`la conexión quedó en «${db0}», no en KRONOSDB_PRUEBAS: se aborta`);
    await pool.request().batch(`EXECUTE AS USER = N'${usuario}' WITH NO REVERT;`);
    const verificar = async () => {
      const r = await pool.request().query('SELECT DB_NAME() AS db, USER_NAME() AS u');
      const f = r?.recordset?.[0] ?? {};
      if (String(f.db).toUpperCase() !== BASE_PRUEBAS) throw new ErrorGuarda(`la sesión está en «${f.db}», no en KRONOSDB_PRUEBAS: se aborta`);
      if (String(f.u).toLowerCase() !== usuario) throw new ErrorGuarda(`la sesión no está suplantada como ${usuario} (está como «${f.u}»): se aborta`);
    };
    await verificar();
    return { pool, verificar, cerrar, usuario };
  } catch (e) {
    await cerrar();
    if (/cannot execute as the database principal|no existe|does not exist|not exist/i.test(e?.message ?? '')) {
      throw new Error(`falta el usuario ${usuario} en KRONOSDB_PRUEBAS (scripts/pruebas-kronos-usuarios.sql): el conector no corre sin él`);
    }
    throw e;
  }
}

/** SELECT con tope de filas (en modo stream: corta al pasarse). */
export async function consultar({ driver, sec, sql, limite = FILAS_DEFECTO, timeoutMs = TIMEOUT_CONSULTA_MS }) {
  const tope = Math.min(Math.max(Number.parseInt(limite, 10) || FILAS_DEFECTO, 1), MAX_FILAS);
  const s = await abrirSesion({ driver, sec, modo: 'consultar', timeoutMs });
  const t0 = Date.now();
  try {
    await s.verificar();
    const req = s.pool.request();
    req.stream = true;
    const conjuntos = [];
    let actual = null;
    let total = 0;
    let truncado = false;
    const r = await new Promise((resolve, reject) => {
      req.on('recordset', (cols) => {
        actual = { columnas: Object.keys(cols ?? {}), filas: [] };
        conjuntos.push(actual);
      });
      req.on('row', (fila) => {
        if (total >= tope) {
          if (!truncado) {
            truncado = true;
            try {
              req.cancel();
            } catch {}
          }
          return;
        }
        total += 1;
        if (!actual) {
          actual = { columnas: Object.keys(fila), filas: [] };
          conjuntos.push(actual);
        }
        actual.filas.push(Object.fromEntries(Object.entries(fila).map(([k, v]) => [k, celda(v)])));
      });
      req.on('error', (e) => {
        if (truncado && /cancel/i.test(`${e?.code ?? ''} ${e?.message ?? ''}`)) return;
        reject(e);
      });
      req.on('done', () => resolve(null));
      req.query(sql);
    });
    void r;
    return { conjuntos, filas: total, truncado, tope, ms: Date.now() - t0 };
  } finally {
    await s.cerrar();
  }
}

/**
 * Corre uno o varios lotes (DML/DDL) suplantado como el usuario de escritura.
 * Se detiene en el primer lote con error. Devuelve lo que pasó en cada lote.
 */
export async function ejecutarLotes({ driver, sec, lotes, timeoutMs = TIMEOUT_ESCRITURA_MS, maxFilas = FILAS_DEFECTO }) {
  const s = await abrirSesion({ driver, sec, modo: 'ejecutar', timeoutMs });
  const t0 = Date.now();
  const resultados = [];
  try {
    for (let i = 0; i < lotes.length; i += 1) {
      await s.verificar();
      const req = s.pool.request();
      const mensajes = [];
      req.on('info', (m) => {
        if (mensajes.length < 200) mensajes.push(String(m?.message ?? '').slice(0, 500));
      });
      const ti = Date.now();
      try {
        const r = await req.batch(lotes[i]);
        const conjuntos = (r?.recordsets ?? []).map((rs) => ({
          columnas: rs?.length ? Object.keys(rs[0]) : [],
          filas: rs.slice(0, maxFilas).map((f) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, celda(v)]))),
          total: rs.length,
        }));
        resultados.push({ lote: i + 1, ok: true, filasAfectadas: r?.rowsAffected ?? [], conjuntos, mensajes, ms: Date.now() - ti });
      } catch (e) {
        resultados.push({ lote: i + 1, ok: false, error: mensajeError(e), mensajes, ms: Date.now() - ti });
        break;
      }
    }
    // El último control: la sesión sigue en la base de pruebas y suplantada.
    await s.verificar();
    return { resultados, ok: resultados.length === lotes.length && resultados.every((r) => r.ok), ms: Date.now() - t0 };
  } finally {
    await s.cerrar();
  }
}

/** Mensaje del error de SQL Server (con los previos, que dicen la causa real). */
export function mensajeError(e) {
  const partes = [];
  for (const p of e?.precedingErrors ?? []) if (p?.message) partes.push(p.message);
  if (e?.message) partes.push(e.message);
  return [...new Set(partes)].join(' | ').slice(0, 2000) || 'error';
}

/** Lista de bases del servidor (para la guarda de nombres de 3 partes). Nunca lanza. */
export async function basesDelServidor({ driver, sec }) {
  let pool;
  try {
    pool = new driver.ConnectionPool(configMssql(sec, 15_000));
    await pool.connect();
    const r = await pool.request().query('SELECT name FROM sys.databases');
    return (r?.recordset ?? []).map((x) => x.name);
  } catch {
    return null;
  } finally {
    try {
      await pool?.close();
    } catch {}
  }
}
