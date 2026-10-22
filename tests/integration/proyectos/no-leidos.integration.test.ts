import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * Icono «Proyectos» de la cabecera (2026-10-19) contra un SQL Server real (CI: `prisma db push`
 * + la migración 20261019140000_proyectos_no_leidos). Prueba la PUERTA del contador (dueño,
 * lector, alguien de fuera, módulo revocado, proyecto archivado), que los mensajes del agente
 * cuentan y los propios no, y la marca de lectura por persona (solo avanza, no pasa del último).
 */
const url = process.env.SGC_IT_DATABASE_URL;

vi.mock('../../../lib/prisma', async () => {
  const { PrismaClient } = await import('../../../app/generated/prisma');
  return { prisma: new PrismaClient({ datasources: { db: { url: process.env.SGC_IT_DATABASE_URL ?? 'sqlserver://localhost:1;database=x;user=x;password=x' } } }) };
});

import { prisma } from '../../../lib/prisma';
import { PROJECTS_MODULE_URL } from '../../../lib/chat/projects-rules';
import { marcarLeidaProyecto, marcarTodoLeido, resumenNoLeidos } from '../../../lib/proyectos/no-leidos';
import type { ProjectUser } from '../../../lib/chat/projects';

describe.skipIf(!url)('Proyectos · no leídos · integración con SQL Server', () => {
  const s = Date.now().toString(36);
  let dueno: ProjectUser;
  let lector: ProjectUser;
  let ajeno: ProjectUser;
  let revocado: ProjectUser;
  let idAgent = 0;
  let idProject = 0;
  let idArchivado = 0;
  let conv = 0;
  let convArchivado = 0;
  let permisoRevocado = 0;

  beforeAll(async () => {
    const empresa = await prisma.company.create({ data: { company: `NOLEIDOS-IT-${s}` } });
    let sub = await prisma.subprocess.findFirst({ where: { subprocess_url: PROJECTS_MODULE_URL } });
    if (!sub) {
      const proc = await prisma.process.create({ data: { process: `Proyectos IT ${s}` } });
      sub = await prisma.subprocess.create({ data: { subprocess: 'Proyectos', subprocess_url: PROJECTS_MODULE_URL, id_process: proc.id_process } });
    }
    const [a, b, c, d] = await Promise.all(
      ['dueno', 'lector', 'ajeno', 'revocado'].map((n) => prisma.user.create({ data: { email: `${n}.noleidos.${s}@gsslatam.com`, name: `${n} IT`, isActive: true } }))
    );
    dueno = { id: a!.id, email: a!.email };
    lector = { id: b!.id, email: b!.email };
    ajeno = { id: c!.id, email: c!.email };
    revocado = { id: d!.id, email: d!.email };
    // Los cuatro tienen el módulo en la empresa; «ajeno» no es miembro.
    for (const u of [dueno, lector, ajeno, revocado]) {
      const cu = await prisma.companyUser.create({ data: { id_company: empresa.id_company, id_user: u.id } });
      const p = await prisma.subprocessUserCompany.create({ data: { id_subprocess: sub.id_subprocess, id_company_user: cu.id_company_user } });
      if (u === revocado) permisoRevocado = p.id_subprocess_user_company;
    }
    const ag = await prisma.agent.create({ data: { code: `noleidos-it-${s}`, display_name: 'Play IT' } });
    idAgent = ag.id_agent;

    const crear = async (name: string) => {
      const p = await prisma.chatProject.create({ data: { name, id_agent: idAgent, id_company: empresa.id_company, profile: 'sin-conectores', created_by: dueno.id } });
      await prisma.chatProjectMember.createMany({
        data: [
          { id_project: p.id_project, id_user: dueno.id, role: 'owner' },
          { id_project: p.id_project, id_user: lector.id, role: 'reader' },
          { id_project: p.id_project, id_user: revocado.id, role: 'editor' },
        ],
      });
      const c = await prisma.chatConversation.create({
        data: { kind: 'project', id_project: p.id_project, title: `${name} · hilo`, id_company: empresa.id_company, id_user: dueno.id, created_by: dueno.id, id_agent: idAgent, last_message_at: new Date() },
      });
      return { idProject: p.id_project, conv: c.id };
    };
    ({ idProject, conv } = await crear('Comex IT'));
    ({ idProject: idArchivado, conv: convArchivado } = await crear('Archivado IT'));

    // Comex: el dueño escribe, el agente responde dos veces.
    await prisma.chatMessage.create({ data: { id_conversation: conv, role: 'user', body: 'Hola, ¿cómo va la DIM?', id_user_author: dueno.id } });
    await prisma.chatMessage.create({ data: { id_conversation: conv, role: 'agent', body: '**Va bien**', id_agent_author: idAgent } });
    await prisma.chatMessage.create({ data: { id_conversation: conv, role: 'agent', body: 'Ya quedó radicada la DIM 123.', id_agent_author: idAgent } });
    await prisma.chatMessage.create({ data: { id_conversation: conv, role: 'system', body: 'evento de sistema' } });
    // Archivado: un mensaje que nadie debe ver en el contador.
    await prisma.chatMessage.create({ data: { id_conversation: convArchivado, role: 'agent', body: 'secreto archivado', id_agent_author: idAgent } });
    await prisma.chatProject.update({ where: { id_project: idArchivado }, data: { archived: true } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('el dueño ve los dos del agente (los suyos y los de sistema no cuentan); nada del archivado', async () => {
    const r = await resumenNoLeidos(dueno, { detalle: true });
    expect(r).toMatchObject({ noLeidos: 1, mensajes: 2 });
    expect(r?.items).toHaveLength(1);
    expect(r?.items?.[0]).toMatchObject({ idProject, idConversation: conv, projectName: 'Comex IT', ultimo: { autor: 'Play IT', autorTipo: 'agente', fragmento: 'Ya quedó radicada la DIM 123.' } });
    expect(JSON.stringify(r)).not.toMatch(/secreto archivado/);
  });

  it('un LECTOR también ve sus no leídos, incluido lo que escribió el dueño', async () => {
    const r = await resumenNoLeidos(lector, { detalle: true });
    expect(r).toMatchObject({ noLeidos: 1, mensajes: 3 });
  });

  it('alguien que NO es miembro no ve nada de ese proyecto: ni número, ni nombre, ni fragmento', async () => {
    const r = await resumenNoLeidos(ajeno, { detalle: true });
    expect(r).toEqual({ noLeidos: 0, mensajes: 0, items: [] });
  });

  it('sin el permiso del módulo, aunque siga de miembro: null (la ruta da 403)', async () => {
    await prisma.subprocessUserCompany.delete({ where: { id_subprocess_user_company: permisoRevocado } });
    expect(await resumenNoLeidos(revocado, { detalle: true })).toBeNull();
  });

  it('abrir la conversación la marca leída SOLO para quien la abrió; la marca solo avanza y no pasa del último', async () => {
    const r = await marcarLeidaProyecto(dueno.id, conv, 10_000_000);
    expect(r.unreadCount).toBe(0);
    const ultimo = await prisma.chatMessage.findFirstOrThrow({ where: { id_conversation: conv }, orderBy: { id: 'desc' } });
    expect(r.marca).toBe(ultimo.id);
    expect(await resumenNoLeidos(dueno, { detalle: false })).toEqual({ noLeidos: 0, mensajes: 0 });
    // El lector sigue con lo suyo.
    expect(await resumenNoLeidos(lector, { detalle: false })).toMatchObject({ noLeidos: 1, mensajes: 3 });
    // Una marca vieja no «deslee».
    await marcarLeidaProyecto(dueno.id, conv, 1);
    const fila = await prisma.chatProjectRead.findUniqueOrThrow({ where: { id_conversation_id_user: { id_conversation: conv, id_user: dueno.id } } });
    expect(fila.last_read_message_id).toBe(ultimo.id);
    // Llega uno nuevo del agente: vuelve a contar.
    await prisma.chatMessage.create({ data: { id_conversation: conv, role: 'agent', body: 'Otra cosa', id_agent_author: idAgent } });
    expect(await resumenNoLeidos(dueno, { detalle: false })).toEqual({ noLeidos: 1, mensajes: 1 });
  });

  it('«Marcar todo como leído» del lector deja su contador en cero', async () => {
    const r = await marcarTodoLeido(lector);
    expect(r).toEqual({ conversaciones: 1 });
    expect(await resumenNoLeidos(lector, { detalle: false })).toEqual({ noLeidos: 0, mensajes: 0 });
  });

  it('la base no admite dos marcas para la misma persona y conversación', async () => {
    await expect(prisma.chatProjectRead.create({ data: { id_conversation: conv, id_user: dueno.id, last_read_message_id: 1 } })).rejects.toThrow();
  });
});
