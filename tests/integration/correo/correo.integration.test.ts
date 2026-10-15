import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../../../app/generated/prisma';
import { CORREO_SUBPROCESS_URL } from '../../../lib/correo/constants';
import {
  activarHilo,
  auditar,
  buscarUsuariosEmpresa,
  correosRegistrados,
  getCorreoAccess,
  hilosParaSincronizar,
  liberarHilo,
  registrarCorreo,
  reservarHilo,
  solicitudesDeCorreos,
  usuarioDeEmpresa,
  usuariosPorCorreo,
  vincularExistente,
  vinculoDeHilo,
  vinculosDeHilos,
  vinculosDeSolicitud,
} from '../../../lib/correo/db';
import { isCorreoError } from '../../../lib/correo/errors';

/**
 * Integración del módulo Correo contra un SQL Server real (CI: `prisma db push`
 * + la migración 20261015120000_correo_modulo con su trigger y CHECK, y el
 * script del permiso). Prueba el permiso por empresa, la idempotencia de la
 * conversión (reserva por hilo + correo único global), el aislamiento por
 * persona y la auditoría inmutable.
 */
const url = process.env.SGC_IT_DATABASE_URL;

async function codigo(p: Promise<unknown>): Promise<string | number> {
  try {
    await p;
    return 0;
  } catch (e) {
    if (isCorreoError(e)) return e.code ?? e.status;
    throw e;
  }
}

describe.skipIf(!url)('Correo · integración con SQL Server', () => {
  const prisma = new PrismaClient({ datasources: { db: { url: url ?? '' } } });
  const s = Date.now().toString(36);
  const correoA = `laura.${s}@gsslatam.com`;
  const correoB = `maria.${s}@gsslatam.com`;
  let idA = '';
  let idB = '';
  let idEmpresa = 0;
  let idOtra = 0;

  beforeAll(async () => {
    const empresa = await prisma.company.create({ data: { company: `CORREO-IT-${s}` } });
    const otra = await prisma.company.create({ data: { company: `CORREO-IT-OTRA-${s}` } });
    idEmpresa = empresa.id_company;
    idOtra = otra.id_company;
    const a = await prisma.user.create({ data: { email: correoA, name: 'Laura IT', isActive: true } });
    const b = await prisma.user.create({ data: { email: correoB, name: 'María IT', isActive: true } });
    await prisma.user.create({ data: { email: `prov.${s}@externo.com`, name: 'Proveedor', role: 'supplier', isActive: true } });
    await prisma.user.create({ data: { email: `inactivo.${s}@gsslatam.com`, name: 'Inactivo', isActive: false } });
    idA = a.id;
    idB = b.id;
    const sub = await prisma.subprocess.findFirst({ where: { subprocess_url: CORREO_SUBPROCESS_URL } });
    if (!sub) throw new Error('Falta el subproceso /process/correo (prisma/manual/2026-10-15-correo-permiso.sql).');
    const cuA = await prisma.companyUser.create({ data: { id_company: idEmpresa, id_user: idA } });
    await prisma.companyUser.create({ data: { id_company: idEmpresa, id_user: idB } });
    await prisma.companyUser.create({ data: { id_company: idOtra, id_user: idB } });
    await prisma.subprocessUserCompany.create({ data: { id_subprocess: sub.id_subprocess, id_company_user: cuA.id_company_user } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('permiso: solo con el subproceso «Correo» en la empresa; proveedores e inactivos nunca', async () => {
    const a = await getCorreoAccess(prisma, correoA);
    expect(a).toMatchObject({ idUser: idA, empresas: [{ idCompany: idEmpresa }] });
    expect(await getCorreoAccess(prisma, correoB)).toBeNull();
    expect(await getCorreoAccess(prisma, `prov.${s}@externo.com`)).toBeNull();
    expect(await getCorreoAccess(prisma, `inactivo.${s}@gsslatam.com`)).toBeNull();
  });

  it('usuarios: por correo (solo activos e internos), por empresa y búsqueda', async () => {
    const m = await usuariosPorCorreo(prisma, [correoA.toUpperCase(), `prov.${s}@externo.com`, `inactivo.${s}@gsslatam.com`]);
    expect([...m.keys()]).toEqual([correoA]);
    expect((await usuarioDeEmpresa(prisma, idB, idOtra))?.id).toBe(idB);
    expect(await usuarioDeEmpresa(prisma, idA, idOtra)).toBeNull();
    const r = await buscarUsuariosEmpresa(prisma, idEmpresa, `maria.${s}`);
    expect(r.map((u) => u.id)).toEqual([idB]);
  });

  it('conversión idempotente: reserva por hilo, correo único global, liberar y activar', async () => {
    const conv = `CONV-${s}-1`;
    const imid = `<m1.${s}@x>`;
    const r = await reservarHilo(prisma, { idUser: idA, mailbox: correoA, conversationId: conv, asunto: 'Contrato', correos: [{ internetMessageId: imid, recibido: '2026-10-14T10:00:00Z' }] });
    // Mientras se crea, otra conversión del mismo hilo espera.
    expect(await codigo(reservarHilo(prisma, { idUser: idA, mailbox: correoA, conversationId: conv, asunto: 'x', correos: [] }))).toBe('EN_CURSO');
    // Otra persona que recibió el MISMO correo no puede crear otra solicitud.
    expect(await codigo(reservarHilo(prisma, { idUser: idB, mailbox: correoB, conversationId: `OTRO-${s}`, asunto: 'x', correos: [{ internetMessageId: imid, recibido: null }] }))).toBe('DUPLICADO');
    expect(await prisma.emailThreadLink.count({ where: { id_user: idB } })).toBe(0);
    // Mientras está CREANDO no cuenta como duplicado visible.
    expect((await solicitudesDeCorreos(prisma, [imid])).size).toBe(0);
    await activarHilo(prisma, r.idLink, 4242);
    expect((await solicitudesDeCorreos(prisma, [imid])).get(imid)).toBe(4242);
    expect(await codigo(reservarHilo(prisma, { idUser: idA, mailbox: correoA, conversationId: conv, asunto: 'x', correos: [] }))).toBe('DUPLICADO');
    // Liberar una reserva fallida deja reintentar.
    const r2 = await reservarHilo(prisma, { idUser: idA, mailbox: correoA, conversationId: `CONV-${s}-2`, asunto: 'y', correos: [{ internetMessageId: `<m2.${s}@x>`, recibido: null }] });
    await liberarHilo(prisma, r2.idLink);
    expect((await correosRegistrados(prisma, [`<m2.${s}@x>`])).size).toBe(0);
    await reservarHilo(prisma, { idUser: idA, mailbox: correoA, conversationId: `CONV-${s}-2`, asunto: 'y', correos: [{ internetMessageId: `<m2.${s}@x>`, recibido: null }] });
  });

  it('aislamiento: los vínculos de una persona no los ve otra', async () => {
    const conv = `CONV-${s}-1`;
    expect((await vinculosDeHilos(prisma, idA, [conv])).get(conv)?.idRequest).toBe(4242);
    expect((await vinculosDeHilos(prisma, idB, [conv])).size).toBe(0);
    expect(await vinculoDeHilo(prisma, idB, conv)).toBeNull();
    expect((await vinculosDeSolicitud(prisma, idA, 4242)).length).toBe(1);
    expect((await vinculosDeSolicitud(prisma, idB, 4242)).length).toBe(0);
    // La tarea de fondo ve cada hilo con SU dueño (para leer el buzón de ese dueño).
    const h = await hilosParaSincronizar(prisma, 500);
    expect(h.find((x) => x.conversationId === conv)).toMatchObject({ idUser: idA, idRequest: 4242 });
  });

  it('vincular a una solicitud existente: una vez por hilo; notas idempotentes por correo', async () => {
    const v = await vincularExistente(prisma, { idUser: idB, mailbox: correoB, conversationId: `CONV-${s}-B`, idRequest: 4242, asunto: 'Existente' });
    expect(v).toMatchObject({ idRequest: 4242, origen: 'VINCULADA' });
    expect(await codigo(vincularExistente(prisma, { idUser: idB, mailbox: correoB, conversationId: `CONV-${s}-B`, idRequest: 1, asunto: null }))).toBe('DUPLICADO');
    expect(await registrarCorreo(prisma, { idLink: v.id, internetMessageId: `<n1.${s}@x>`, tipo: 'NOTA', recibido: null })).toBe(true);
    expect(await registrarCorreo(prisma, { idLink: v.id, internetMessageId: `<n1.${s}@x>`, tipo: 'NOTA', recibido: null })).toBe(false);
    // El correo de origen de OTRA persona tampoco se duplica como nota.
    expect(await registrarCorreo(prisma, { idLink: v.id, internetMessageId: `<m1.${s}@x>`, tipo: 'NOTA', recibido: null })).toBe(false);
  });

  it('la base exige id_request en un vínculo ACTIVO y tipos válidos', async () => {
    await expect(
      prisma.$executeRawUnsafe(`INSERT INTO dbo.email_thread_link (id_user, mailbox, conversation_id, estado, origen, created_by) VALUES (N'${idA}', N'x', N'CK-${s}', N'ACTIVO', N'CREADA', N'${idA}')`)
    ).rejects.toThrow();
    await expect(
      prisma.$executeRawUnsafe(`INSERT INTO dbo.email_thread_link (id_user, mailbox, conversation_id, id_request, estado, origen, created_by) VALUES (N'${idA}', N'x', N'CK2-${s}', 1, N'OTRO', N'CREADA', N'${idA}')`)
    ).rejects.toThrow();
  });

  it('auditoría inmutable (sin cuerpos de correo)', async () => {
    await auditar(prisma, { idUser: idA, mailbox: correoA, accion: 'LEER_HILO', mensajeId: 'AAMkM1', conversationId: `CONV-${s}-1`, detalle: '2 mensaje(s)', ip: '10.0.0.1' });
    await auditar(prisma, { idUser: idA, mailbox: correoA, accion: 'CREAR_SOLICITUD', conversationId: `CONV-${s}-1`, idRequest: 4242, detalle: 'Empresa 1, proceso 10', ip: '10.0.0.1' });
    const lectura = await prisma.emailAudit.findFirst({ where: { id_user: idA, accion: 'LEER_HILO' } });
    expect(lectura).toMatchObject({ mailbox: correoA, mensaje_id: 'AAMkM1' });
    const fila = await prisma.emailAudit.findFirst({ where: { id_user: idA, accion: 'CREAR_SOLICITUD' } });
    expect(fila).toMatchObject({ id_request: 4242, ip: '10.0.0.1' });
    await expect(prisma.$executeRawUnsafe(`UPDATE dbo.email_audit SET detalle = N'x' WHERE id = ${fila!.id}`)).rejects.toThrow(/no se puede editar/);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM dbo.email_audit WHERE id = ${fila!.id}`)).rejects.toThrow(/no se puede editar/);
  });
});
