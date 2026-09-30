/* eslint-disable @typescript-eslint/no-require-imports, security/detect-non-literal-fs-filename -- script Node plano que corre en el servidor, fuera del bundle */
/**
 * Publica las decisiones por artículo (JSON de decisiones_articulo.py, opción
 * --decisiones de generar_farmalogica.py / generar_empresa.py) en
 * dbo.predictivo_decisiones.
 *
 * Uso (en el servidor, desde la carpeta del proyecto para resolver `mssql` y
 * leer el .env):
 *   node publicar_decisiones.js <decisiones.json> --base=KRONOSDB_PRUEBAS
 *
 * Salvaguardas:
 *  - `--base` es OBLIGATORIO y debe coincidir con la base del DATABASE_URL
 *    (solo se aceptan las de BASES_PERMITIDAS). Sin él no se publica nada.
 *  - NO crea la tabla: el DDL va a mano (prisma/manual/2026-09-30-predictivo-decisiones.sql).
 *  - Idempotente: en UNA transacción borra lo de la empresa + fecha de corte y
 *    carga las filas nuevas (bulk insert). Si algo falla, no queda nada a medias.
 */
const fs = require('fs');
const path = require('path');
const sql = require('mssql');

const BASES_PERMITIDAS = ['KRONOSDB_PRUEBAS', 'KRONOSDB'];
const DECISIONES = ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8'];
const CALIDADES = ['alta', 'media', 'baja'];

function leerDatabaseUrl() {
  // el .env de pce0023 puede venir con BOM
  const env = fs.readFileSync(path.join(process.cwd(), '.env'), 'utf8').replace(/^\uFEFF/, '');
  const linea = env.split(/\r?\n/).find((l) => /^\s*DATABASE_URL\s*=/.test(l));
  if (!linea) throw new Error('No hay DATABASE_URL en .env');
  return linea.replace(/^\s*DATABASE_URL\s*=\s*/, '').replace(/^["']|["']$/g, '').trim();
}

function aConfig(url) {
  // sqlserver://HOST:PUERTO;database=..;user=..;password=..;encrypt=..;trustServerCertificate=..
  const [hostPart, ...pares] = url.replace(/^sqlserver:\/\//, '').split(';');
  const [server, port] = hostPart.split(':');
  const kv = {};
  for (const p of pares) {
    const i = p.indexOf('=');
    if (i > 0) kv[p.slice(0, i).trim().toLowerCase()] = p.slice(i + 1).trim();
  }
  return {
    server,
    port: Number(port || 1433),
    database: kv.database || kv['initial catalog'],
    user: kv.user || kv.username,
    password: (kv.password || '').replace(/^\{|\}$/g, ''),
    options: { encrypt: kv.encrypt === 'true', trustServerCertificate: kv.trustservercertificate !== 'false' },
    requestTimeout: 120000,
  };
}

function validar(doc) {
  if (!Number.isInteger(doc.company_id) || doc.company_id <= 0) throw new Error('company_id inválido');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(doc.fecha_corte || '')) throw new Error('fecha_corte inválida');
  if (!Array.isArray(doc.filas)) throw new Error('No hay filas');
  const vistos = new Set();
  for (const f of doc.filas) {
    if (!f.item_code || !DECISIONES.includes(f.decision) || !f.opcion || !CALIDADES.includes(f.calidad) || !f.motivo) {
      throw new Error(`Fila inválida: ${JSON.stringify(f).slice(0, 200)}`);
    }
    if (f.probabilidad != null && (f.probabilidad < 0 || f.probabilidad > 1)) {
      throw new Error(`Probabilidad fuera de rango en ${f.item_code}/${f.decision}`);
    }
    const k = `${f.item_code}|${f.decision}`;
    if (vistos.has(k)) throw new Error(`Fila duplicada ${k}`);
    vistos.add(k);
  }
}

function tabla(doc) {
  const t = new sql.Table('dbo.predictivo_decisiones');
  t.create = false;
  t.columns.add('company_id', sql.Int, { nullable: false });
  t.columns.add('fecha_corte', sql.Date, { nullable: false });
  t.columns.add('version_motor', sql.VarChar(20), { nullable: false });
  t.columns.add('item_code', sql.NVarChar(50), { nullable: false });
  t.columns.add('item_nombre', sql.NVarChar(200), { nullable: true });
  t.columns.add('decision', sql.VarChar(4), { nullable: false });
  t.columns.add('opcion', sql.VarChar(20), { nullable: false });
  t.columns.add('probabilidad', sql.Decimal(5, 4), { nullable: true });
  t.columns.add('cantidad', sql.Decimal(18, 2), { nullable: true });
  t.columns.add('impacto_cop', sql.Decimal(18, 2), { nullable: true });
  t.columns.add('prioridad', sql.Decimal(18, 2), { nullable: true });
  t.columns.add('calidad', sql.VarChar(5), { nullable: false });
  t.columns.add('accionable', sql.Bit, { nullable: false });
  t.columns.add('motivo', sql.NVarChar(400), { nullable: false });
  t.columns.add('detalle', sql.NVarChar(sql.MAX), { nullable: true });
  const fecha = new Date(`${doc.fecha_corte}T00:00:00Z`);
  for (const f of doc.filas) {
    t.rows.add(
      doc.company_id,
      fecha,
      String(doc.version_motor || 'sin-version').slice(0, 20),
      String(f.item_code).slice(0, 50),
      f.item_nombre ? String(f.item_nombre).slice(0, 200) : null,
      f.decision,
      String(f.opcion).slice(0, 20),
      f.probabilidad ?? null,
      f.cantidad ?? null,
      f.impacto_cop ?? null,
      f.prioridad ?? null,
      f.calidad,
      Boolean(f.accionable),
      String(f.motivo).slice(0, 400),
      f.detalle ? JSON.stringify(f.detalle) : null
    );
  }
  return t;
}

(async () => {
  const args = process.argv.slice(2);
  const flagBase = args.find((a) => a.startsWith('--base='));
  const [archivo] = args.filter((a) => !a.startsWith('--'));
  if (!archivo || !flagBase) {
    throw new Error('Uso: node publicar_decisiones.js <decisiones.json> --base=KRONOSDB_PRUEBAS|KRONOSDB');
  }
  const baseEsperada = flagBase.slice('--base='.length);
  if (!BASES_PERMITIDAS.includes(baseEsperada)) throw new Error(`Base "${baseEsperada}" no está permitida.`);
  const doc = JSON.parse(fs.readFileSync(archivo, 'utf8'));
  validar(doc);
  const cfg = aConfig(leerDatabaseUrl());
  if (cfg.database !== baseEsperada) {
    throw new Error(`Base "${cfg.database}" no es ${baseEsperada}: no se publica nada.`);
  }
  const pool = await sql.connect(cfg);
  try {
    const existe = await pool.request().query("SELECT OBJECT_ID(N'dbo.predictivo_decisiones', N'U') AS oid");
    if (!existe.recordset[0].oid) {
      throw new Error('No existe dbo.predictivo_decisiones: aplique primero prisma/manual/2026-09-30-predictivo-decisiones.sql');
    }
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      const del = await new sql.Request(tx)
        .input('company', sql.Int, doc.company_id)
        .input('fecha', sql.Date, new Date(`${doc.fecha_corte}T00:00:00Z`))
        .query('DELETE FROM dbo.predictivo_decisiones WHERE company_id = @company AND fecha_corte = @fecha');
      let insertadas = 0;
      if (doc.filas.length > 0) {
        const r = await new sql.Request(tx).bulk(tabla(doc));
        insertadas = r.rowsAffected;
      }
      await tx.commit();
      const resumen = {};
      for (const f of doc.filas) resumen[`${f.decision}:${f.opcion}`] = (resumen[`${f.decision}:${f.opcion}`] || 0) + 1;
      console.log(
        `OK company=${doc.company_id} fecha_corte=${doc.fecha_corte} borradas=${del.rowsAffected[0]} ` +
          `insertadas=${insertadas} ${JSON.stringify(resumen)}`
      );
    } catch (e) {
      await tx.rollback();
      throw e;
    }
  } finally {
    await pool.close();
  }
})().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
