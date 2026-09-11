/**
 * Diagnóstico de login (sin imprimir la contraseña).
 * Uso:
 *   node scripts/check-login.mjs --email=tu@correo.com
 *   node scripts/check-login.mjs --email=tu@correo.com --password=TuClave
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import bcrypt from 'bcryptjs';
import sql from 'mssql';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function loadEnv() {
  const envPath = path.join(root, '.env');
  if (!fs.existsSync(envPath)) throw new Error('No se encontró .env');
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    const key = m[1].trim();
    if (process.env[key] !== undefined) continue;
    process.env[key] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}

function parseArgs() {
  const emailArg = process.argv.find((a) => a.startsWith('--email='));
  const passArg = process.argv.find((a) => a.startsWith('--password='));
  return {
    email: emailArg ? emailArg.split('=').slice(1).join('=').trim() : '',
    password: passArg ? passArg.split('=').slice(1).join('=') : '',
  };
}

async function main() {
  loadEnv();
  const { email, password } = parseArgs();
  if (!email) {
    console.error('Uso: node scripts/check-login.mjs --email=tu@correo.com [--password=clave]');
    process.exit(1);
  }

  const dbconfig = (await import(pathToFileURL(path.join(root, 'dbconfig.js')).href)).default;
  const cfg = typeof dbconfig.buildMssqlConfig === 'function' ? dbconfig.buildMssqlConfig() : dbconfig;

  console.log(`\n=== Diagnóstico login: ${email} ===\n`);

  const pool = await sql.connect(cfg);

  const exact = await pool
    .request()
    .input('email', sql.NVarChar(255), email)
    .query(`
      SELECT TOP 1 id, name, email, role, isActive,
        CASE WHEN password IS NULL THEN 0 ELSE 1 END AS has_password,
        LEFT(password, 7) AS hash_prefix
      FROM [user]
      WHERE email = @email
    `);

  const insensitive = await pool
    .request()
    .input('email', sql.NVarChar(255), email.trim())
    .query(`
      SELECT TOP 1 id, name, email, role, isActive,
        CASE WHEN password IS NULL THEN 0 ELSE 1 END AS has_password,
        LEFT(password, 7) AS hash_prefix
      FROM [user]
      WHERE LOWER(LTRIM(RTRIM(email))) = LOWER(LTRIM(RTRIM(@email)))
    `);

  const row = insensitive.recordset[0] || exact.recordset[0];

  if (!row) {
    console.log('❌ No existe usuario con ese correo en [user].');
    console.log('   Verifica el email exacto (dominio, mayúsculas).');
    const similar = await pool.request().input('q', sql.NVarChar(100), `%${email.split('@')[0]}%`).query(`
      SELECT TOP 5 email, name, role, isActive FROM [user]
      WHERE email LIKE @q OR name LIKE @q
      ORDER BY email
    `);
    if (similar.recordset.length) {
      console.log('\n   Correos parecidos:');
      for (const u of similar.recordset) console.log(`   - ${u.email} (${u.name}, role=${u.role})`);
    }
    await pool.close();
    process.exit(1);
  }

  if (exact.recordset[0] && insensitive.recordset[0] && exact.recordset[0].email !== email) {
    console.log(`⚠️  El correo en BD es: "${row.email}" (no coincide exactamente con lo que escribes).`);
  }

  console.log('Usuario encontrado:');
  console.log(`  id:        ${row.id}`);
  console.log(`  email:     ${row.email}`);
  console.log(`  name:      ${row.name}`);
  console.log(`  role:      ${row.role}`);
  console.log(`  isActive:  ${row.isActive}`);
  console.log(`  password:  ${row.has_password ? `sí (${row.hash_prefix}...)` : 'NO — debe restablecer contraseña'}`);

  const blockers = [];
  if (row.role === 'supplier') blockers.push('Rol supplier → debe entrar por /proveedor/login');
  if (!row.isActive) blockers.push('Usuario inactivo (isActive=0)');
  if (!row.has_password) blockers.push('Sin contraseña en BD → usar "Olvidé mi contraseña"');

  if (row.hash_prefix && !String(row.hash_prefix).startsWith('$2')) {
    blockers.push('La contraseña NO parece bcrypt ($2...) — formato legacy incompatible con login actual');
  }

  if (blockers.length) {
    console.log('\n❌ Motivos por los que el login falla:');
    blockers.forEach((b) => console.log(`   - ${b}`));
  } else {
    console.log('\n✓ Usuario parece válido para login interno.');
  }

  if (password && row.has_password) {
    const full = await pool
      .request()
      .input('id', sql.NVarChar(255), row.id)
      .query(`SELECT password FROM [user] WHERE id = @id`);
    const hash = full.recordset[0]?.password;
    const ok = hash ? await bcrypt.compare(password, hash) : false;
    console.log(`\nPrueba de contraseña: ${ok ? '✓ CORRECTA' : '❌ INCORRECTA'}`);
    if (!ok) console.log('   La clave que ingresas no coincide con el hash guardado en BD.');
  } else if (password) {
    console.log('\n(No hay hash en BD para probar la contraseña.)');
  } else {
    console.log('\nTip: agrega --password=TuClave para probar si la contraseña coincide.');
  }

  await pool.close();
}

main().catch((err) => {
  console.error('\nError de conexión o consulta:', err.message);
  console.error('¿Estás en VPN / red con acceso a 192.168.10.3?');
  process.exit(1);
});
