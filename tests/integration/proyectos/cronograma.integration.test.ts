import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * Cronograma de Proyectos contra un SQL Server real (CI: `prisma db push` + la migración
 * 20261018180000_proyectos_cronograma con sus CHECK y el trigger de auditoría inmutable).
 * Prueba permisos por rol, auditoría, propuestas (nada cambia sin confirmar) y el candado.
 */
const url = process.env.SGC_IT_DATABASE_URL;

vi.mock('../../../lib/prisma', async () => {
  const { PrismaClient } = await import('../../../app/generated/prisma');
  return { prisma: new PrismaClient({ datasources: { db: { url: process.env.SGC_IT_DATABASE_URL ?? 'sqlserver://localhost:1;database=x;user=x;password=x' } } }) };
});
// Las fechas vivas de las solicitudes se leen con mssql; aquí no hay vínculos.
vi.mock('../../../lib/mssqlPool', () => ({ sql: {}, withMssqlPool: async () => { throw new Error('sin mssql en la prueba'); } }));

import { prisma } from '../../../lib/prisma';
import { ProyectoError } from '../../../lib/proyectos/acciones';
import { borrarTarea, crearTarea, cronogramaDelProyecto, editarTarea, historial } from '../../../lib/proyectos/cronograma';
import { confirmarPropuesta, crearPropuestasDelPuente, propuestasPendientes, rechazarPropuesta } from '../../../lib/proyectos/propuestas';
import type { ProjectAccess, ProjectUser } from '../../../lib/chat/projects';

describe.skipIf(!url)('Proyectos · cronograma · integración con SQL Server', () => {
  const s = Date.now().toString(36);
  let dueno: ProjectUser;
  let editor: ProjectUser;
  let lector: ProjectUser;
  let idProject = 0;
  let idAgent = 0;
  const acceso = (role: ProjectAccess['role']): ProjectAccess => ({ idProject, name: 'Comex IT', idCompany: 0, profile: 'sin-conectores', role, archived: false });

  beforeAll(async () => {
    const empresa = await prisma.company.create({ data: { company: `CRONO-IT-${s}` } });
    const [a, b, c] = await Promise.all(
      ['dueno', 'editor', 'lector'].map((n) => prisma.user.create({ data: { email: `${n}.crono.${s}@gsslatam.com`, name: `${n} IT`, isActive: true } }))
    );
    dueno = { id: a!.id, email: a!.email };
    editor = { id: b!.id, email: b!.email };
    lector = { id: c!.id, email: c!.email };
    const ag = await prisma.agent.create({ data: { code: `crono-it-${s}`, display_name: 'Orus IT' } });
    idAgent = ag.id_agent;
    const p = await prisma.chatProject.create({ data: { name: 'Comex IT', id_agent: ag.id_agent, id_company: empresa.id_company, profile: 'sin-conectores', created_by: dueno.id } });
    idProject = p.id_project;
    await prisma.chatProjectMember.createMany({
      data: [
        { id_project: idProject, id_user: dueno.id, role: 'owner' },
        { id_project: idProject, id_user: editor.id, role: 'editor' },
        { id_project: idProject, id_user: lector.id, role: 'reader' },
      ],
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('los CHECK de la base frenan datos imposibles aunque el código fallara', async () => {
    const base = { id_project: idProject, title: 'x', start_date: new Date('2026-10-10'), end_date: new Date('2026-10-12'), created_by: editor.id };
    await expect(prisma.chatProjectTask.create({ data: { ...base, status: 'cerrada' } })).rejects.toThrow();
    await expect(prisma.chatProjectTask.create({ data: { ...base, progress: 150 } })).rejects.toThrow();
    await expect(prisma.chatProjectTask.create({ data: { ...base, end_date: new Date('2026-10-01') } })).rejects.toThrow();
    await expect(prisma.chatProjectTask.create({ data: { ...base, is_milestone: true } })).rejects.toThrow();
    const ahora = new Date();
    const g = { id_user: dueno.id, id_agent: idAgent, id_chat_conversation: 1, created_at: ahora };
    await expect(prisma.chatProjectGrant.create({ data: { ...g, token: `pg_largo${s}`, expires_at: new Date(ahora.getTime() + 30 * 3600_000) } })).rejects.toThrow();
    await expect(prisma.chatProjectGrant.create({ data: { ...g, token: `cs_otro${s}`, expires_at: new Date(ahora.getTime() + 3600_000) } })).rejects.toThrow();
    await expect(
      prisma.chatProjectProposal.create({ data: { id_project: idProject, kind: 'tarea_crear', payload: '{}', summary: 'x', source: 'mcp', id_agent: idAgent, expires_at: new Date(ahora.getTime() + 3600_000) } })
    ).rejects.toThrow();
    expect(await prisma.chatProjectTask.count({ where: { id_project: idProject } })).toBe(0);
  });

  it('el editor crea y cambia tareas; el lector no; todo queda en la auditoría inmutable', async () => {
    const { id } = await crearTarea(editor, acceso('editor'), { title: 'Radicar DIM', startDate: '2026-10-10', endDate: '2026-10-15', idResponsible: dueno.id });
    await expect(crearTarea(lector, acceso('reader'), { title: 'x', startDate: '2026-10-10' })).rejects.toBeInstanceOf(ProyectoError);
    await expect(crearTarea(editor, acceso('editor'), { title: 'x', startDate: '2026-10-10', idResponsible: 'no-es-miembro' })).rejects.toThrow(/miembro/);
    await editarTarea(editor, acceso('editor'), id, { status: 'en_curso', progress: 40 });
    const t = await prisma.chatProjectTask.findUniqueOrThrow({ where: { id_project_task: id } });
    expect(t).toMatchObject({ status: 'en_curso', progress: 40, created_by: editor.id, updated_by: editor.id });
    expect(t.start_date.toISOString().slice(0, 10)).toBe('2026-10-10');
    const h = await historial(acceso('reader'), 'tarea', id);
    expect(h.map((e) => e.action)).toEqual(['estado', 'crear']);
    expect(h.every((e) => e.by?.id === editor.id)).toBe(true);
    // Inmutable: ni se cambia ni se borra.
    const ev = await prisma.chatProjectEvent.findFirstOrThrow({ where: { id_project: idProject, entity: 'tarea', id_entity: id } });
    await expect(prisma.chatProjectEvent.update({ where: { id_event: ev.id_event }, data: { detail: 'alterado' } })).rejects.toThrow();
    await expect(prisma.chatProjectEvent.delete({ where: { id_event: ev.id_event } })).rejects.toThrow();
    // El editor no borra la tarea de otro… (la creó él: sí la borra el dueño)
    const delDueno = await crearTarea(dueno, acceso('owner'), { title: 'Del dueño', startDate: '2026-10-11' });
    await expect(borrarTarea(editor, acceso('editor'), delDueno.id)).rejects.toThrow(/dueño|creó/);
    await borrarTarea(dueno, acceso('owner'), delDueno.id);
    const c = await cronogramaDelProyecto(lector, acceso('reader'));
    expect(c.tasks.map((x) => x.title)).toEqual(['Radicar DIM']);
    expect(c.capabilities.crear).toBe(false);
    expect(c.tasks[0]).toMatchObject({ responsible: { id: dueno.id }, puedoEditar: false, puedoBorrar: false });
  });

  it('propuesta del puente: no cambia nada hasta que un editor la confirma; el lector no puede; un solo clic', async () => {
    const antes = await prisma.chatProjectTask.count({ where: { id_project: idProject } });
    const r = await crearPropuestasDelPuente({ id: 4040, idProject }, idAgent, [
      { kind: 'tarea_crear', tarea: { title: 'Hito: llega el barco', startDate: '2026-10-25', isMilestone: true, responsable: 'editor IT' } },
      { kind: 'miembro_invitar', email: 'x@y.com', role: 'editor' },
    ]);
    expect(r.creadas).toHaveLength(1);
    expect(r.rechazadas).toHaveLength(1);
    expect(await prisma.chatProjectTask.count({ where: { id_project: idProject } })).toBe(antes);
    const [pend] = await propuestasPendientes(lector, acceso('reader'));
    expect(pend).toMatchObject({ id: r.creadas[0], puedoConfirmar: false });
    await expect(confirmarPropuesta(lector, acceso('reader'), r.creadas[0])).rejects.toBeInstanceOf(ProyectoError);
    await confirmarPropuesta(editor, acceso('editor'), r.creadas[0]);
    const t = await prisma.chatProjectTask.findFirstOrThrow({ where: { id_project: idProject, title: 'Hito: llega el barco' } });
    expect(t).toMatchObject({ is_milestone: true, origin: 'agente', created_by: editor.id, id_responsible: editor.id });
    await expect(confirmarPropuesta(editor, acceso('editor'), r.creadas[0])).rejects.toThrow(/ya se decidió/);
    expect(await prisma.chatProjectTask.count({ where: { id_project: idProject, title: 'Hito: llega el barco' } })).toBe(1);
  });

  it('propuesta del MCP: solo la confirma la persona de la concesión, y con la concesión vigente', async () => {
    const ahora = new Date();
    const g = await prisma.chatProjectGrant.create({ data: { token: `pg_it${s}${'A'.repeat(20)}`.slice(0, 40), id_user: dueno.id, id_agent: idAgent, id_project: idProject, id_chat_conversation: 1, created_at: ahora, expires_at: new Date(ahora.getTime() + 3600_000) } });
    const p = await prisma.chatProjectProposal.create({
      data: { id_project: idProject, kind: 'tarea_editar', payload: JSON.stringify({ kind: 'tarea_editar', idTask: (await prisma.chatProjectTask.findFirstOrThrow({ where: { id_project: idProject, title: 'Radicar DIM' } })).id_project_task, tarea: { status: 'hecha', progress: 100 } }), summary: 'Cerrar Radicar DIM', source: 'mcp', id_agent: idAgent, id_grant: g.id_grant, requested_for: dueno.id, expires_at: g.expires_at },
    });
    await expect(confirmarPropuesta(editor, acceso('editor'), p.id_proposal)).rejects.toThrow(/Solo la persona/);
    await rechazarPropuesta(editor, acceso('editor'), p.id_proposal).catch((e) => expect(String(e)).toMatch(/Solo la persona/));
    await prisma.chatProjectGrant.update({ where: { id_grant: g.id_grant }, data: { revoked_at: new Date() } });
    await expect(confirmarPropuesta(dueno, acceso('owner'), p.id_proposal)).rejects.toThrow(/venció|revocó/);
    await prisma.chatProjectGrant.update({ where: { id_grant: g.id_grant }, data: { revoked_at: null } });
    await confirmarPropuesta(dueno, acceso('owner'), p.id_proposal);
    const t = await prisma.chatProjectTask.findFirstOrThrow({ where: { id_project: idProject, title: 'Radicar DIM' } });
    expect(t).toMatchObject({ status: 'hecha', progress: 100, updated_by: dueno.id });
    const ev = await prisma.chatProjectEvent.findMany({ where: { id_project: idProject, entity: 'propuesta', id_entity: p.id_proposal } });
    expect(ev.map((e) => e.action)).toContain('confirmar');
  });
});
