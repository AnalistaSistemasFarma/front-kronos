/**
 * Migra la columna id_executor_final en la tabla [case] (mesa de ayuda).
 *
 * Uso:
 *   node scripts/migrate-case-executor-column.cjs
 *   node scripts/migrate-case-executor-column.cjs --database=KRONOSDB
 *   node scripts/migrate-case-executor-column.cjs --database=KRONOSDB_PRUEBAS
 */
const fs = require('fs');
const path = require('path');

const CONNECTION_KEYS = new Set([
  'DATABASE_URL',
  'SAPSENDSQL_SERVER',
  'SAPSENDSQL_BD',
  'SAPSENDSQL_USER',
  'SAPSENDSQL_PASS',
]);

function loadEnv({ forceConnection = false } = {}) {
  for (const name of ['.env.local', '.env']) {
    const envPath = path.resolve(__dirname, '..', name);
    if (!fs.existsSync(envPath)) continue;
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (!m) continue;
      const key = m[1].trim();
      const value = m[2].trim().replace(/^["']|["']$/g, '');
      if (forceConnection && CONNECTION_KEYS.has(key)) {
        process.env[key] = value;
      } else if (!process.env[key]) {
        process.env[key] = value;
      }
    }
    break;
  }
}

function parseArgs() {
  const databaseArg = process.argv.find((arg) => arg.startsWith('--database='));
  return {
    database: databaseArg ? databaseArg.split('=')[1]?.trim() : null,
  };
}

function patchDatabaseUrl(database) {
  const current = process.env.DATABASE_URL || '';
  if (!current) return;

  if (/database=[^;]+/i.test(current)) {
    process.env.DATABASE_URL = current.replace(/database=[^;]+/i, `database=${database}`);
    return;
  }

  process.env.DATABASE_URL = `${current};database=${database}`;
}

const MIGRATION_SQL = `
IF NOT EXISTS (
  SELECT 1
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'case' AND COLUMN_NAME = 'id_executor_final'
)
BEGIN
  ALTER TABLE [case] ADD id_executor_final NVARCHAR(255) NULL;
END
`;

async function main() {
  loadEnv({ forceConnection: true });

  const { database } = parseArgs();
  if (database) {
    process.env.SAPSENDSQL_BD = database;
    patchDatabaseUrl(database);
  }

  const { resolveConnection } = require('../dbconfig');
  const configured = resolveConnection();

  if (!configured.server || !configured.database) {
    throw new Error(
      'No se pudo resolver la conexión. Revise DATABASE_URL o SAPSENDSQL_* en .env'
    );
  }

  console.log(`Conectando a: ${configured.server}/${configured.database}`);

  const { PrismaClient } = require('../app/generated/prisma');
  const prisma = new PrismaClient();

  const dbRow = await prisma.$queryRawUnsafe('SELECT DB_NAME() AS db');
  const activeDb = dbRow[0]?.db;
  console.log(`Base de datos activa: ${activeDb}`);

  await prisma.$executeRawUnsafe(MIGRATION_SQL);

  const check = await prisma.$queryRawUnsafe(`
    SELECT
      COLUMN_NAME,
      DATA_TYPE,
      CHARACTER_MAXIMUM_LENGTH,
      IS_NULLABLE
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'case' AND COLUMN_NAME = 'id_executor_final'
  `);

  if (!check.length) {
    throw new Error('La columna id_executor_final no se encontró después de la migración.');
  }

  console.log('Migración OK:', check[0]);
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error('Error en migración:', error.message || error);
  process.exit(1);
});
