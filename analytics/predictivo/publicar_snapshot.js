/* eslint-disable @typescript-eslint/no-require-imports, security/detect-non-literal-fs-filename -- script Node plano que corre en el servidor, fuera del bundle */
/**
 * Publica un JSON del motor predictivo en la tabla predictivo_snapshots de la
 * base de PRUEBAS (KRONOSDB_PRUEBAS). Lo sube y ejecuta run_nightly.sh en
 * pce0023, desde la carpeta del proyecto (para resolver `mssql` y leer el .env
 * en tiempo de ejecución; las credenciales nunca salen del servidor).
 *
 * Uso (en el servidor):  node publicar_snapshot.js <archivo.json> <company_id>
 *
 * Salvaguarda: se niega a escribir si la base del DATABASE_URL no es
 * KRONOSDB_PRUEBAS. La tabla se crea de forma idempotente (IF NOT EXISTS).
 */
const fs = require('fs');
const path = require('path');
const sql = require('mssql');

function leerDatabaseUrl() {
  const env = fs.readFileSync(path.join(process.cwd(), '.env'), 'utf8');
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
  };
}

(async () => {
  const [archivo, companyArg] = process.argv.slice(2);
  if (!archivo || !companyArg) throw new Error('Uso: node publicar_snapshot.js <archivo.json> <company_id>');
  const payload = fs.readFileSync(archivo, 'utf8');
  JSON.parse(payload); // valida
  const cfg = aConfig(leerDatabaseUrl());
  if (cfg.database !== 'KRONOSDB_PRUEBAS') {
    throw new Error(`Base "${cfg.database}" no es KRONOSDB_PRUEBAS: no se publica nada.`);
  }
  const pool = await sql.connect(cfg);
  await pool.request().query(`
    IF OBJECT_ID(N'dbo.predictivo_snapshots', N'U') IS NULL
    BEGIN
      CREATE TABLE dbo.predictivo_snapshots (
        id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        company_id INT NOT NULL,
        generated_at DATETIME2 NOT NULL CONSTRAINT DF_predictivo_snapshots_gen DEFAULT SYSDATETIME(),
        payload NVARCHAR(MAX) NOT NULL
      );
      CREATE INDEX IX_predictivo_snapshots_company ON dbo.predictivo_snapshots (company_id, generated_at DESC);
    END`);
  const antes = await pool.request().query('SELECT COUNT(*) AS n FROM dbo.predictivo_snapshots');
  const r = await pool
    .request()
    .input('company', sql.Int, Number(companyArg))
    .input('payload', sql.NVarChar(sql.MAX), payload)
    .query(`INSERT INTO dbo.predictivo_snapshots (company_id, payload)
            OUTPUT INSERTED.id, INSERTED.generated_at
            VALUES (@company, @payload)`);
  console.log(`OK snapshot id=${r.recordset[0].id} generated_at=${r.recordset[0].generated_at.toISOString()} ` +
    `filas antes=${antes.recordset[0].n} bytes=${Buffer.byteLength(payload)}`);
  await pool.close();
})().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
