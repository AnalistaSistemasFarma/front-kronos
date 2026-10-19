/**
 * Proyectos desde un agente · SQL REAL del MCP (concesión, puerta por persona, propuestas,
 * lecturas del cronograma) contra SQL Server: que las consultas crudas corran tal cual en la
 * base migrada y que el alcance se cumpla.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../../app/generated/prisma/index.js';
import { setPrisma } from '../src/db.js';
import type { AuthScope } from '../src/auth.js';
import { proponerEnProyecto, ProyectosRechazo, proyectosVisibles, resolverConcesionProyectos, solicitudesDe, tareasDe } from '../src/proyectos/nucleo.js';

const url = process.env.SGC_IT_DATABASE_URL;

describe.skipIf(!url)('kronos-mcp · proyecto_* · integración con SQL Server', () => {
  const prisma = new PrismaClient({ datasources: { db: { url: url ?? '' } } });
  const s = Date.now().toString(36);
  const token = `pg_it${s}${'A'.repeat(20)}`.slice(0, 40);
  let scope: AuthScope;
  let idUser = '';
  let idProject = 0;
  let idModulo = 0;
  let idCu = 0;

  beforeAll(async () => {
    setPrisma(prisma);
    const empresa = await prisma.company.create({ data: { company: `MCP-PROY-IT-${s}` } });
    const u = await prisma.user.create({ data: { email: `silvia.proy.${s}@gsslatam.com`, name: 'Silvia IT', isActive: true } });
    idUser = u.id;
    const proc = await prisma.process.create({ data: { process: `Proy IT ${s}` } });
    const sub = await prisma.subprocess.create({ data: { subprocess: 'Orus IT', subprocess_url: `/process/chat/orus-proy-it-${s}`, id_process: proc.id_process } });
    const modulo =
      (await prisma.subprocess.findFirst({ where: { subprocess_url: '/process/proyectos' } })) ??
      (await prisma.subprocess.create({ data: { subprocess: 'Proyectos', subprocess_url: '/process/proyectos', id_process: proc.id_process } }));
    idModulo = modulo.id_subprocess;
    const ag = await prisma.agent.create({ data: { code: `orus-proy-it-${s}`, display_name: 'Orus IT', id_subprocess: sub.id_subprocess } });
    await prisma.agentCompany.create({ data: { id_agent: ag.id_agent, id_company: empresa.id_company } });
    const cu = await prisma.companyUser.create({ data: { id_company: empresa.id_company, id_user: u.id } });
    idCu = cu.id_company_user;
    await prisma.subprocessUserCompany.create({ data: { id_subprocess: sub.id_subprocess, id_company_user: cu.id_company_user } });
    await prisma.subprocessUserCompany.create({ data: { id_subprocess: idModulo, id_company_user: cu.id_company_user } });
    const chat = await prisma.chatConversation.create({ data: { kind: 'direct', id_user: u.id, id_agent: ag.id_agent, title: 'Orus IT' } });
    const p = await prisma.chatProject.create({ data: { name: 'Comex MCP IT', id_agent: ag.id_agent, id_company: empresa.id_company, profile: 'sin-conectores', created_by: u.id } });
    idProject = p.id_project;
    await prisma.chatProjectMember.create({ data: { id_project: idProject, id_user: u.id, role: 'editor' } });
    await prisma.chatProjectTask.create({ data: { id_project: idProject, title: 'Radicar DIM', start_date: new Date('2026-10-10'), end_date: new Date('2026-10-15'), status: 'en_curso', progress: 40, created_by: u.id } });
    const ahora = new Date();
    await prisma.chatProjectGrant.create({ data: { token, id_user: u.id, id_agent: ag.id_agent, id_project: null, id_chat_conversation: chat.id, created_at: ahora, expires_at: new Date(ahora.getTime() + 24 * 3600_000) } });
    scope = { agent: ag.code, role: 'admin', allCompanies: true, companyIds: [] };
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('resuelve la concesión y la puerta con el SQL real; lee el cronograma', async () => {
    const { concesion } = await resolverConcesionProyectos(scope, token);
    expect(concesion.idUser).toBe(idUser);
    const visibles = await proyectosVisibles(concesion);
    expect(visibles.map((p) => [p.idProject, p.role])).toEqual([[idProject, 'editor']]);
    expect(await proyectosVisibles(concesion, idProject + 100000)).toEqual([]);
    const tareas = await tareasDe(idProject, '2026-10-18');
    expect(tareas[0]).toMatchObject({ title: 'Radicar DIM', startDate: '2026-10-10', endDate: '2026-10-15', vencida: true });
    // requests_general no está en el esquema de Prisma: la base efímera de la CI no la tiene
    // (igual que en las demás pruebas de integración). Esta lectura solo se prueba si existe.
    const hay = await prisma.$queryRaw<{ n: number }[]>`SELECT CASE WHEN OBJECT_ID(N'dbo.requests_general', N'U') IS NULL THEN 0 ELSE 1 END AS n`;
    if (Number(hay[0]?.n) === 1) expect(await solicitudesDe(idProject, '2026-10-18')).toEqual([]);
  });

  it('proponer: pendiente + aviso en el chat + auditoría; ninguna tarea nueva', async () => {
    const antes = await prisma.chatProjectTask.count({ where: { id_project: idProject } });
    const r = await proponerEnProyecto(scope, token, idProject, 'tarea_crear', async () => ({ payload: { tarea: { title: 'Revisar', startDate: '2026-10-20' } }, resumen: 'Tarea «Revisar»' }));
    const p = await prisma.chatProjectProposal.findUniqueOrThrow({ where: { id_proposal: r.propuesta_id } });
    expect(p).toMatchObject({ status: 'pendiente', source: 'mcp', requested_for: idUser, kind: 'tarea_crear' });
    expect(await prisma.chatProjectTask.count({ where: { id_project: idProject } })).toBe(antes);
    expect(await prisma.chatProjectEvent.count({ where: { id_project: idProject, entity: 'propuesta', action: 'proponer', via: 'mcp' } })).toBe(1);
  });

  it('como LECTORA no propone; sin el permiso del módulo ya no ve el proyecto', async () => {
    await prisma.chatProjectMember.updateMany({ where: { id_project: idProject, id_user: idUser }, data: { role: 'reader' } });
    await expect(proponerEnProyecto(scope, token, idProject, 'tarea_crear', async () => ({ payload: {}, resumen: 'x' }))).rejects.toBeInstanceOf(ProyectosRechazo);
    await prisma.subprocessUserCompany.deleteMany({ where: { id_subprocess: idModulo, id_company_user: idCu } });
    const { concesion } = await resolverConcesionProyectos(scope, token);
    expect(await proyectosVisibles(concesion)).toEqual([]);
  });
});
