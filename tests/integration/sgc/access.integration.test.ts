import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../../../app/generated/prisma';
import { getActiveSgcCompanyIds, getSgcAccessForUser } from '../../../lib/sgc/access';
import { SGC_PROCESS_NAME, SGC_SUBPROCESS_NAMES, SGC_SUBPROCESS_URLS } from '../../../lib/sgc/constants';

/**
 * Integración del SGC documental contra un SQL Server real: valida que el
 * esquema `sgc` (Prisma multiSchema) funciona de punta a punta y que el
 * acceso respeta las dos llaves (permiso + empresa activa).
 *
 * La base la prepara la CI: `prisma db push` del esquema completo sobre un
 * SQL Server efímero y luego las migraciones del S0 (idempotentes).
 */
const url = process.env.SGC_IT_DATABASE_URL;

describe.skipIf(!url)('SGC · integración con SQL Server', () => {
  const prisma = new PrismaClient({ datasources: { db: { url: url ?? '' } } });
  const OLP = 3;
  const FARMA = 1;
  const email = 'calidad.it@onelatampharma.com';

  beforeAll(async () => {
    // company.id_company es IDENTITY: se siembran los ids reales (1 y 3) con IDENTITY_INSERT.
    // Idempotente: otras suites de integración (p. ej. la del Sprint 1) comparten la base.
    await prisma.$executeRawUnsafe(`
      SET IDENTITY_INSERT [dbo].[company] ON;
      IF NOT EXISTS (SELECT 1 FROM [dbo].[company] WHERE id_company = ${FARMA}) INSERT INTO [dbo].[company] (id_company, company) VALUES (${FARMA}, N'FARMALOGICA S.A.');
      IF NOT EXISTS (SELECT 1 FROM [dbo].[company] WHERE id_company = ${OLP}) INSERT INTO [dbo].[company] (id_company, company) VALUES (${OLP}, N'ONELATAMPHARMA');
      SET IDENTITY_INSERT [dbo].[company] OFF;`);

    const user = await prisma.user.create({ data: { email, name: 'Calidad IT' } });
    const process = await prisma.process.create({ data: { process: SGC_PROCESS_NAME } });
    const subs = await Promise.all(
      (Object.keys(SGC_SUBPROCESS_URLS) as (keyof typeof SGC_SUBPROCESS_URLS)[]).map((perm) =>
        prisma.subprocess.create({
          data: { subprocess: SGC_SUBPROCESS_NAMES[perm], subprocess_url: SGC_SUBPROCESS_URLS[perm], id_process: process.id_process },
        })
      )
    );
    const cuOlp = await prisma.companyUser.create({ data: { id_company: OLP, id_user: user.id } });
    const cuFarma = await prisma.companyUser.create({ data: { id_company: FARMA, id_user: user.id } });

    const lectura = subs.find((s) => s.subprocess_url === SGC_SUBPROCESS_URLS.lectura)!;
    const calidad = subs.find((s) => s.subprocess_url === SGC_SUBPROCESS_URLS.calidad)!;
    await prisma.subprocessUserCompany.createMany({
      data: [
        { id_subprocess: lectura.id_subprocess, id_company_user: cuOlp.id_company_user },
        { id_subprocess: calidad.id_subprocess, id_company_user: cuOlp.id_company_user },
        // Permiso en Farmalógica, que NO está activa en el SGC:
        { id_subprocess: lectura.id_subprocess, id_company_user: cuFarma.id_company_user },
      ],
    });

    for (const cfg of [
      { id_company: OLP, is_active: true, storage_root: 'SGC/OLP', activated_by: 'ci', activated_at: new Date() },
      { id_company: FARMA, is_active: false, storage_root: 'SGC/FARMALOGICA' },
    ]) {
      await prisma.sgcCompanyConfig.upsert({ where: { id_company: cfg.id_company }, create: cfg, update: {} });
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('[SGC-REQ-011] la tabla de configuración vive en el esquema SQL propio `sgc`', async () => {
    const rows = await prisma.$queryRaw<{ esquema: string }[]>`
      SELECT s.name AS esquema FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id
      WHERE t.name = 'company_config'`;
    expect(rows.map((r) => r.esquema)).toEqual(['sgc']);
  });

  it('[SGC-REQ-011] las tablas de plataforma siguen en `dbo` (el esquema sgc no las mueve)', async () => {
    const rows = await prisma.$queryRaw<{ esquema: string }[]>`
      SELECT s.name AS esquema FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id
      WHERE t.name IN ('company', 'user', 'subprocess', 'subprocess_user_company')`;
    expect(new Set(rows.map((r) => r.esquema))).toEqual(new Set(['dbo']));
  });

  it('[SGC-REQ-004] solo OLP queda activa en el SGC', async () => {
    expect(await getActiveSgcCompanyIds(prisma)).toEqual([OLP]);
  });

  it('[SGC-REQ-004][SGC-REQ-005] el acceso respeta permiso + empresa activa', async () => {
    const access = await getSgcAccessForUser(prisma, email);
    expect(access).toEqual([
      { idCompany: OLP, companyName: 'ONELATAMPHARMA', canRead: true, canManage: false, canQuality: true, canAdminFlows: false },
    ]);
  });

  it('[SGC-REQ-004] un usuario sin permisos no ve el módulo', async () => {
    expect(await getSgcAccessForUser(prisma, 'nadie@gsslatam.com')).toEqual([]);
  });

  it('[SGC-REQ-009] las tablas del módulo documental retirado no existen en dbo (las del SGC viven en `sgc`)', async () => {
    const rows = await prisma.$queryRaw<{ n: number }[]>`
      SELECT COUNT(*) AS n FROM sys.tables
      WHERE schema_id = SCHEMA_ID('dbo')
        AND name IN ('document', 'document_type', 'document_version', 'document_process_category', 'document_process_subprocess')`;
    expect(Number(rows[0].n)).toBe(0);
  });
});
