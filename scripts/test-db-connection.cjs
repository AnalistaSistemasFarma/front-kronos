const fs = require('fs');
const path = require('path');
const sql = require('mssql');

const root = path.resolve(__dirname, '..');
const envPath = path.join(root, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    const key = m[1].trim();
    const value = m[2].trim().replace(/^['"]|['"]$/g, '');
    if (!process.env[key]) process.env[key] = value;
  }
}

const { resolveConnection } = require('../dbconfig');

async function main() {
  const conn = resolveConnection();
  console.log('Servidor:', conn.server, 'puerto:', conn.port, 'BD:', conn.database);

  await sql.connect({
    user: conn.user,
    password: conn.password,
    database: conn.database,
    server: conn.server,
    port: conn.port,
    options: { encrypt: false, trustServerCertificate: true },
    connectionTimeout: 10000,
    requestTimeout: 10000,
  });

  const r = await sql.query('SELECT 1 AS ok');
  console.log('Conexión OK:', r.recordset[0]);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('Conexión FALLÓ:', e.message);
    process.exit(1);
  });
