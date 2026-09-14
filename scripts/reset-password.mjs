/**
 * Restablece la contraseña de un usuario (solo entorno local / BD de pruebas).
 * Uso:
 *   node scripts/reset-password.mjs --email=tu@correo.com --password=NuevaClave123
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

  if (!email || !password) {
    console.error('Uso: node scripts/reset-password.mjs --email=tu@correo.com --password=NuevaClave');
    process.exit(1);
  }

  if (password.length < 8) {
    console.error('La contraseña debe tener al menos 8 caracteres.');
    process.exit(1);
  }

  const dbconfig = (await import(pathToFileURL(path.join(root, 'dbconfig.js')).href)).default;
  const cfg = typeof dbconfig.buildMssqlConfig === 'function' ? dbconfig.buildMssqlConfig() : dbconfig;

  const pool = await sql.connect(cfg);

  const found = await pool
    .request()
    .input('email', sql.NVarChar(255), email.trim())
    .query(`
      SELECT TOP 1 id, email, name, role, isActive
      FROM [user]
      WHERE LOWER(LTRIM(RTRIM(email))) = LOWER(LTRIM(RTRIM(@email)))
    `);

  const row = found.recordset[0];
  if (!row) {
    console.error(`❌ No existe usuario con correo: ${email}`);
    await pool.close();
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, 12);

  await pool
    .request()
    .input('id', sql.NVarChar(255), row.id)
    .input('password', sql.NVarChar(255), hash)
    .query(`UPDATE [user] SET password = @password WHERE id = @id`);

  const ok = await bcrypt.compare(password, hash);
  console.log(`\n✓ Contraseña actualizada para ${row.email} (${row.name})`);
  console.log(`  Verificación bcrypt: ${ok ? 'OK' : 'ERROR'}`);
  console.log('\nEntra en http://localhost:8080/login con el correo y la nueva clave.');

  await pool.close();
}

main().catch((err) => {
  console.error('\nError:', err.message);
  process.exit(1);
});
