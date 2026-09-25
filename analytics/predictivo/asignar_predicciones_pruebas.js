/* eslint-disable @typescript-eslint/no-require-imports -- script Node plano que corre en el servidor, fuera del bundle */
/**
 * Asigna el subproceso "Predicciones" (id 92, '/process/predicciones') a
 * nicolas.rivera@gsslatam.com en Ryan (2), OLP (3), Meditrack (6), Abamia (7)
 * y Kelab (9), solo donde ya tenga company_user. Idempotente (NOT EXISTS).
 *
 * Uso (en pce0023, dentro de la carpeta del proyecto de PRUEBAS):
 *   node asignar_predicciones_pruebas.js
 * Salvaguarda: se niega a escribir si la base no es KRONOSDB_PRUEBAS.
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
  const cfg = aConfig(leerDatabaseUrl());
  if (cfg.database !== 'KRONOSDB_PRUEBAS') throw new Error('no es PRUEBAS: ' + cfg.database);
  const pool = await sql.connect(cfg);
  const r = await pool.request().query(`
    INSERT INTO subprocess_user_company (id_subprocess, id_company_user)
    OUTPUT INSERTED.id_subprocess_user_company, INSERTED.id_company_user
    SELECT 92, cu.id_company_user FROM company_user cu JOIN [user] u ON u.id = cu.id_user
    WHERE u.email = 'nicolas.rivera@gsslatam.com' AND cu.id_company IN (2,3,6,7,9)
      AND NOT EXISTS (SELECT 1 FROM subprocess_user_company s WHERE s.id_subprocess = 92 AND s.id_company_user = cu.id_company_user)`);
  console.log('insertadas', JSON.stringify(r.recordset));
  console.log(JSON.stringify((await pool.request().query(`SELECT cu.id_company FROM subprocess_user_company s JOIN company_user cu ON cu.id_company_user=s.id_company_user JOIN [user] u ON u.id=cu.id_user WHERE s.id_subprocess=92 AND u.email='nicolas.rivera@gsslatam.com'`)).recordset));
  await pool.close();
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
