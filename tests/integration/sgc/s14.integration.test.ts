import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../../../app/generated/prisma';
import { getSgcAccessForUser } from '../../../lib/sgc/access';
import { SGC_PROCESS_NAME, SGC_SUBPROCESS_NAMES, SGC_SUBPROCESS_URLS } from '../../../lib/sgc/constants';
import { getCatalogs } from '../../../lib/sgc/db/catalogs';
import { createInitialDocument, getAccessSubject, getVersionForViewer, grantDocumentAccess, type SgcUploader } from '../../../lib/sgc/db/documents';
import { sgcViewerError } from '../../../lib/sgc/viewerError';

/**
 * S14 (R23, reunión con Calidad OLP del 2026-10-13): «Calidad no abre el
 * vigente en el visor». Prueba de integración de los PERMISOS DEL VISOR por
 * perfil contra un SQL Server real (efímero en CI), con el mismo camino que la
 * ruta /api/sgc/documents/<id>/versions/<v>/file (getVersionForViewer):
 *   - Aseguramiento de Calidad abre el vigente aunque no sea del área dueña;
 *   - la persona del área dueña lo abre (documento «por departamento»);
 *   - la de otra área no (la ruta responde 404 y el visor dice «sin permiso»,
 *     con la opción de solicitar acceso);
 *   - con un acceso de consulta vigente, sí.
 * Empresa propia (id 115).
 */
const url = process.env.SGC_IT_DATABASE_URL;

describe.skipIf(!url)('[SGC-REQ-148] SGC · S14 · permisos del visor por perfil con SQL Server', () => {
  const prisma = new PrismaClient({ datasources: { db: { url: url ?? '' } } });
  const CO = 115;
  const E = {
    cal: 'calidad.s14@onelatampharma.com',
    duena: 'duena.s14@onelatampharma.com',
    otra: 'otra.s14@onelatampharma.com',
  };
  const actor = (email: string) => ({ email, ip: '10.14.14.15', userAgent: 'vitest-s14' });
  const access = async (email: string) => getSgcAccessForUser(prisma, email);
  const upload: SgcUploader = async (_segments, fileName) => ({ id: `s14-${fileName}-${Math.random().toString(36).slice(2, 8)}` });
  const sql = (file: string) => fs.readFileSync(path.join(process.cwd(), 'prisma/manual', file), 'utf8').replace('DECLARE @IdCompany INT = 3;', `DECLARE @IdCompany INT = ${CO};`);
  let deptDuena = 0;
  let deptOtra = 0;
  let idDocument = 0;
  let idVersion = 0;

  beforeAll(async () => {
    await prisma.$executeRawUnsafe(`
      SET IDENTITY_INSERT [dbo].[company] ON;
      IF NOT EXISTS (SELECT 1 FROM [dbo].[company] WHERE id_company = ${CO}) INSERT INTO [dbo].[company] (id_company, company) VALUES (${CO}, N'EMPRESA S14 CI');
      SET IDENTITY_INSERT [dbo].[company] OFF;`);
    await prisma.sgcCompanyConfig.upsert({ where: { id_company: CO }, create: { id_company: CO, is_active: true, storage_root: 'SGC/S14', activated_by: 'ci', activated_at: new Date() }, update: { is_active: true } });
    const proc = await prisma.process.create({ data: { process: `${SGC_PROCESS_NAME} (S14 CI)` } });
    const sub: Record<string, number> = {};
    for (const perm of ['lectura', 'gestion', 'calidad', 'flujos'] as const) {
      sub[perm] = (await prisma.subprocess.create({ data: { subprocess: SGC_SUBPROCESS_NAMES[perm], subprocess_url: SGC_SUBPROCESS_URLS[perm], id_process: proc.id_process } })).id_subprocess;
    }
    deptDuena = (await prisma.department.create({ data: { department: 'S14 ÁREA DUEÑA' } })).id_department;
    deptOtra = (await prisma.department.create({ data: { department: 'S14 OTRA ÁREA' } })).id_department;
    const grants: [string, string[], number | null][] = [
      [E.cal, ['lectura', 'calidad'], null],
      [E.duena, ['lectura'], deptDuena],
      [E.otra, ['lectura'], deptOtra],
    ];
    for (const [email, perms, dept] of grants) {
      const user = await prisma.user.create({ data: { email, name: email.split('@')[0].toUpperCase() } });
      const cu = await prisma.companyUser.create({ data: { id_company: CO, id_user: user.id } });
      for (const p of perms) await prisma.subprocessUserCompany.create({ data: { id_subprocess: sub[p], id_company_user: cu.id_company_user } });
      if (dept) await prisma.departmentUser.create({ data: { id_user: user.id, id_department: dept } });
    }
    await prisma.$executeRawUnsafe(sql('2026-09-30-sgc-s1-maestros-olp.sql'));
    const cat = await getCatalogs(prisma, CO);
    const doc = await createInitialDocument(
      prisma,
      upload,
      {
        idCompany: CO,
        idProcess: cat.processes.find((p) => p.code === 'GC')!.id,
        idDocumentType: cat.documentTypes.find((t) => t.code === 'IN')!.id,
        title: 'Instructivo de la prueba del visor S14',
        confidentiality: 'departamento',
        idOwnerDepartment: deptDuena,
        versionNumber: 1,
        effectiveDate: '2026-10-13',
        pdf: { bytes: new TextEncoder().encode('%PDF-1.7\nS14 visor'), fileName: 'original.pdf' },
      },
      actor(E.cal)
    );
    idDocument = doc.idDocument;
    idVersion = doc.idVersion;
  });

  afterAll(async () => {
    await prisma.sgcCompanyConfig.update({ where: { id_company: CO }, data: { is_active: false } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  const open = async (email: string) => getVersionForViewer(prisma, await access(email), await getAccessSubject(prisma, email), idDocument, idVersion);

  it('Aseguramiento de Calidad abre el vigente en el visor aunque no sea del área dueña', async () => {
    expect((await access(E.cal)).find((a) => a.idCompany === CO)).toMatchObject({ canQuality: true });
    const found = await open(E.cal);
    expect(found).not.toBeNull();
    expect(found!.permissions).toMatchObject({ canView: true, canAdminister: true, canDownload: false, canPrint: false });
    expect(found!.version.status).toBe('vigente');
  });

  it('la persona del área dueña abre el vigente «por departamento» (sin descarga ni impresión)', async () => {
    const found = await open(E.duena);
    expect(found?.permissions).toMatchObject({ canView: true, canAdminister: false, canDownload: false, canPrint: false });
  });

  it('la de otra área no lo abre (la ruta responde 404 y el visor lo explica con la opción de solicitar acceso); con un acceso de consulta vigente, sí', async () => {
    expect(await open(E.otra)).toBeNull();
    expect(sgcViewerError(404, 'Documento no encontrado')).toMatchObject({ kind: 'sin_permiso', title: expect.stringContaining('No tiene permiso') });
    await grantDocumentAccess(prisma, await access(E.cal), idDocument, { userEmail: E.otra, reason: 'Prueba S14: consulta del instructivo' }, actor(E.cal));
    expect((await open(E.otra))?.permissions).toMatchObject({ canView: true, canDownload: false });
  });
});
