#!/usr/bin/env node
/**
 * Genera el SQL que REGISTRA en dbo._prisma_migrations las migraciones del SGC
 * aplicadas a mano en el pase (las migraciones no corren en los despliegues:
 * KRONOSDB no está «baselined», P3005). Checksum = SHA-256 del archivo, como
 * en PRUEBAS. Idempotente (no duplica). Uso:
 *   node scripts/sgc/pase-produccion/registrar-migraciones.mjs > reg.sql
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const dir = path.join(process.cwd(), 'prisma', 'migrations');
const names = fs.readdirSync(dir).filter((d) => /_sgc_/.test(d)).sort();
console.log('/* Registro de las migraciones del SGC aplicadas a mano en el pase (generado). */');
for (const n of names) {
  const sum = createHash('sha256').update(fs.readFileSync(path.join(dir, n, 'migration.sql'))).digest('hex');
  console.log(`IF NOT EXISTS (SELECT 1 FROM [dbo].[_prisma_migrations] WHERE migration_name = N'${n}')
  INSERT INTO [dbo].[_prisma_migrations] (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
  VALUES (LOWER(CONVERT(NVARCHAR(36), NEWID())), N'${sum}', SYSUTCDATETIME(), N'${n}', N'Aplicada a mano en el pase del SGC', NULL, SYSUTCDATETIME(), 1);`);
}
console.log("SELECT migration_name, checksum, finished_at FROM [dbo].[_prisma_migrations] WHERE migration_name LIKE N'%sgc%' ORDER BY migration_name;");
