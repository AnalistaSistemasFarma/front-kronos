/**
 * «Consultar a un agente» · SQL REAL del MCP (resolución de la concesión y propuestas) contra
 * SQL Server: que las consultas crudas corran tal cual en la base y que el alcance se cumpla.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../../app/generated/prisma/index.js';
import { setPrisma } from '../src/db.js';
import type { AuthScope } from '../src/auth.js';
import { CorreoAgenteRechazo, proponer, resolverConcesion, vinculoActivo } from '../src/correo/concesion.js';

const url = process.env.SGC_IT_DATABASE_URL;

describe.skipIf(!url)('kronos-mcp · correo_* · integración con SQL Server', () => {
  const prisma = new PrismaClient({ datasources: { db: { url: url ?? '' } } });
  const s = Date.now().toString(36);
  const token = `cs_it${s}${'A'.repeat(20)}`.slice(0, 40);
  const tokenOtro = `cs_ot${s}${'B'.repeat(20)}`.slice(0, 40);
  let scope: AuthScope;
  let scopeOtro: AuthScope;
  let idUser = '';
  let idShare = 0;
  let idChat = 0;
  let idSuc = 0;

  beforeAll(async () => {
    setPrisma(prisma);
    const empresa = await prisma.company.create({ data: { company: `MCP-AGENTE-IT-${s}` } });
    const u = await prisma.user.create({ data: { email: `laura.mcp.${s}@gsslatam.com`, name: 'Laura MCP', isActive: true } });
    idUser = u.id;
    const proc = await prisma.process.create({ data: { process: `Chat IT ${s}` } });
    const sub = await prisma.subprocess.create({ data: { subprocess: 'Orus IT', subprocess_url: `/process/chat/orus-it-${s}`, id_process: proc.id_process } });
    const subOtro = await prisma.subprocess.create({ data: { subprocess: 'Nancy IT', subprocess_url: `/process/chat/nancy-it-${s}`, id_process: proc.id_process } });
    const ag = await prisma.agent.create({ data: { code: `orus-it-${s}`, display_name: 'Orus IT', id_subprocess: sub.id_subprocess } });
    const otro = await prisma.agent.create({ data: { code: `nancy-it-${s}`, display_name: 'Nancy IT', id_subprocess: subOtro.id_subprocess } });
    await prisma.agentCompany.create({ data: { id_agent: ag.id_agent, id_company: empresa.id_company } });
    await prisma.agentCompany.create({ data: { id_agent: otro.id_agent, id_company: empresa.id_company } });
    const cu = await prisma.companyUser.create({ data: { id_company: empresa.id_company, id_user: u.id } });
    idSuc = (await prisma.subprocessUserCompany.create({ data: { id_subprocess: sub.id_subprocess, id_company_user: cu.id_company_user } })).id_subprocess_user_company;
    await prisma.subprocessUserCompany.create({ data: { id_subprocess: subOtro.id_subprocess, id_company_user: cu.id_company_user } });
    idChat = (await prisma.chatConversation.create({ data: { kind: 'direct', id_user: u.id, id_agent: ag.id_agent, title: 'Orus IT' } })).id;
    const chatOtro = await prisma.chatConversation.create({ data: { kind: 'direct', id_user: u.id, id_agent: otro.id_agent, title: 'Nancy IT' } });
    const ahora = new Date();
    const vence = new Date(ahora.getTime() + 24 * 3600_000);
    idShare = (await prisma.emailAgentShare.create({ data: { token, id_user: u.id, mailbox: u.email, conversation_id: `CONV-MCP-${s}`, asunto: 'Contrato', id_agent: ag.id_agent, id_chat_conversation: idChat, created_at: ahora, expires_at: vence } })).id;
    await prisma.emailAgentShare.create({ data: { token: tokenOtro, id_user: u.id, mailbox: u.email, conversation_id: `CONV-MCP-${s}`, asunto: 'Contrato', id_agent: otro.id_agent, id_chat_conversation: chatOtro.id, created_at: ahora, expires_at: vence } });
    scope = { agent: ag.code, role: 'admin', allCompanies: true, companyIds: [] };
    scopeOtro = { agent: otro.code, role: 'admin', allCompanies: true, companyIds: [] };
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('resuelve la concesión vigente de ESTE agente (SQL real) y rechaza la de otro', async () => {
    const r = await resolverConcesion(scope, token);
    expect(r.concesion).toMatchObject({ id: idShare, idUser, idChat, conversationId: `CONV-MCP-${s}` });
    await expect(resolverConcesion(scopeOtro, token)).rejects.toBeInstanceOf(CorreoAgenteRechazo);
    expect(await prisma.emailAudit.count({ where: { id_user: idUser, accion: 'AGENTE_DENEGADO' } })).toBe(1);
    // Con su propia concesión, el otro agente sí.
    expect((await resolverConcesion(scopeOtro, tokenOtro)).concesion.idAgent).not.toBe(r.concesion.idAgent);
  });

  it('proponer: acción PENDIENTE + mensaje del agente en SU chat + auditoría, en una transacción', async () => {
    const r = await proponer(scope, token, 'RESPUESTA', async () => ({ payload: { cuerpo: 'Hola', todos: false, para: ['x@y.com'] }, chat: '✉️ Propuesta', detalle: 'prueba' }));
    const a = await prisma.emailAgentAction.findUniqueOrThrow({ where: { id: r.propuesta_id } });
    expect(a).toMatchObject({ id_share: idShare, tipo: 'RESPUESTA', estado: 'PENDIENTE', id_chat_message: r.id_mensaje_chat });
    const m = await prisma.chatMessage.findUniqueOrThrow({ where: { id: r.id_mensaje_chat } });
    expect(m).toMatchObject({ id_conversation: idChat, role: 'agent', body: '✉️ Propuesta' });
    expect(await prisma.emailAudit.count({ where: { id_user: idUser, accion: 'AGENTE_PROPONER' } })).toBe(1);
    // Un fallo DENTRO de la propuesta no deja nada a medias.
    const antes = await prisma.emailAgentAction.count({ where: { id_share: idShare } });
    await expect(proponer(scope, token, 'NOTA', async () => { throw new CorreoAgenteRechazo('sin vínculo'); })).rejects.toThrow('sin vínculo');
    expect(await prisma.emailAgentAction.count({ where: { id_share: idShare } })).toBe(antes);
    expect(await vinculoActivo(prisma, { idUser, conversationId: `CONV-MCP-${s}` } as never)).toBeNull();
  });

  it('sin el permiso del agente, o revocada, la concesión ya no sirve', async () => {
    await prisma.subprocessUserCompany.delete({ where: { id_subprocess_user_company: idSuc } });
    await expect(resolverConcesion(scope, token)).rejects.toBeInstanceOf(CorreoAgenteRechazo);
    await prisma.emailAgentShare.update({ where: { id: idShare }, data: { revoked_at: new Date() } });
    await expect(resolverConcesion(scope, token)).rejects.toBeInstanceOf(CorreoAgenteRechazo);
  });
});
