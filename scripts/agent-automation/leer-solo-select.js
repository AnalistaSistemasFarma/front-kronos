// SOLO LECTURA (SELECT). Lee DATABASE_URL del .env del proyecto sin imprimirla.
const fs = require('fs'); const sql = require('mssql');
const env = fs.readFileSync('.env', 'utf8').split(/\r?\n/).find(l => l.startsWith('DATABASE_URL='));
const url = env.slice('DATABASE_URL='.length).replace(/^"|"$/g, '');
const m = url.match(/^sqlserver:\/\/([^:;]+):?(\d+)?;(.*)$/); const kv = {};
for (const p of m[3].split(';')) { const i = p.indexOf('='); if (i > 0) kv[p.slice(0, i).toLowerCase()] = p.slice(i + 1); }
const cfg = { server: m[1], port: +(m[2] || 1433), database: kv.database, user: kv.user, password: kv.password,
  options: { encrypt: kv.encrypt === 'true', trustServerCertificate: true }, requestTimeout: 300000 };
const consulta = fs.readFileSync(process.argv[2], 'utf8');
if (/\b(insert|update|delete|merge|drop|alter|create|truncate|exec|grant|backup|restore)\b/i.test(consulta.replace(/--.*$/mg, '')))
  { console.error('Solo se permiten SELECT'); process.exit(2); }
(async () => { const pool = await sql.connect(cfg); const r = await pool.request().query('SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED; ' + consulta);
  process.stdout.write(JSON.stringify(r.recordsets)); await pool.close(); })().catch(e => { console.error(String(e.message).slice(0, 300)); process.exit(1); });
