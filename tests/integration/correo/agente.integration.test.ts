import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../../../app/generated/prisma';
import { CORREO_SUBPROCESS_URL } from '../../../lib/correo/constants';
import { getCorreoAccess, type AccesoCorreo } from '../../../lib/correo/db';
import { readCorreoConfig } from '../../../lib/correo/config';
import { enviadosSimulados, reiniciarBuzonSimulado } from '../../../lib/correo/mock';
import { accionesDeChat, compartirConAgente, concesionesDeHilo, confirmarAccion, descartarAccion, revocarConcesion, type AgentePort } from '../../../lib/correo/agente';
import type { CorreoDeps } from '../../../lib/correo/service';

/**
 * «Consultar a un agente» contra un SQL Server real (CI: `prisma db push` + la migración
 * 20261016100000_correo_agente con sus CHECK). Prueba la concesión, las tarjetas por persona
 * (anti-IDOR), el candado de un solo envío y la auditoría.
 */
const url = process.env.SGC_IT_DATABASE_URL;
const CONV = 'mock-conv-01AAAA';

describe.skipIf(!url)('Correo · Consultar a un agente · integración con SQL Server', () => {
  const prisma = new PrismaClient({ datasources: { db: { url: url ?? '' } } });
  const s = Date.now().toString(36);
  let laura: AccesoCorreo;
  let maria: AccesoCorreo;
  let idAgent = 0;
  let px: AgentePort;

  const deps = (): CorreoDeps => ({
    db: prisma,
    cfg: readCorreoConfig({ CORREO_MODO: 'mock' }),
    kronos: {
      catalogoEmpresa: async () => ({ categorias: [], procesos: [] }),
      solicitudVisible: async () => null,
      solicitudExiste: async () => true,
      insertarNota: async () => 1,
    },
    crearSolicitud: async () => ({ id_request: 1, processEmail: null, processEmails: [], taskEmails: [] }),
    notificarNueva: () => {},
    subirAdjuntos: async () => ({ subidos: 0, fallidos: [] }),
    dominiosGrupo: ['gsslatam.com'],
  });

  beforeAll(async () => {
    reiniciarBuzonSimulado();
    const empresa = await prisma.company.create({ data: { company: `AGENTE-IT-${s}` } });
    const correoA = `laura.ag.${s}@gsslatam.com`;
    const correoB = `maria.ag.${s}@gsslatam.com`;
    const a = await prisma.user.create({ data: { email: correoA, name: 'Laura IT', isActive: true } });
    const b = await prisma.user.create({ data: { email: correoB, name: 'María IT', isActive: true } });
    const sub = await prisma.subprocess.findFirst({ where: { subprocess_url: CORREO_SUBPROCESS_URL } });
    if (!sub) throw new Error('Falta el subproceso /process/correo.');
    for (const u of [a, b]) {
      const cu = await prisma.companyUser.create({ data: { id_company: empresa.id_company, id_user: u.id } });
      await prisma.subprocessUserCompany.create({ data: { id_subprocess: sub.id_subprocess, id_company_user: cu.id_company_user } });
    }
    const agente = await prisma.agent.create({ data: { code: `orus-it-${s}`, display_name: 'Orus IT' } });
    idAgent = agente.id_agent;
    laura = (await getCorreoAccess(prisma, correoA))!;
    maria = (await getCorreoAccess(prisma, correoB))!;
    // El permiso del chat se prueba en lib/chat; aquí ambas personas tienen el agente.
    px = { db: prisma, agentesDe: async () => [{ idAgent, code: agente.code, displayName: agente.display_name, avatarUrl: null, avatarVersion: null, description: null }] };
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function propuestaDe(acceso: AccesoCorreo, payload: Record<string, unknown>) {
    const r = await compartirConAgente(deps(), px, acceso, { conversationId: CONV, idAgent, ip: '10.1.1.1' });
    const share = await prisma.emailAgentShare.findUniqueOrThrow({ where: { id: r.idShare } });
    // Lo que escribe kronos-mcp al proponer: la acción PENDIENTE y su mensaje de agente en el chat.
    const msg = await prisma.chatMessage.create({ data: { id_conversation: r.idChatConversation, role: 'agent', body: 'Propuesta', id_agent_author: idAgent, delivered_at: new Date() } });
    const a = await prisma.emailAgentAction.create({ data: { id_share: share.id, id_agent: idAgent, tipo: 'RESPUESTA', payload: JSON.stringify(payload), id_chat_message: msg.id } });
    return { share, accion: a, chat: r.idChatConversation };
  }

  it('compartir: concesión de 24 h, chat directo con el contexto (mensaje de la persona) y auditoría', async () => {
    const r = await compartirConAgente(deps(), px, laura, { conversationId: CONV, idAgent, pregunta: 'Ayúdeme', ip: '10.1.1.1' });
    const share = await prisma.emailAgentShare.findUniqueOrThrow({ where: { id: r.idShare } });
    expect(share).toMatchObject({ id_user: laura.idUser, mailbox: laura.email, conversation_id: CONV, id_agent: idAgent, revoked_at: null });
    expect(share.token).toMatch(/^cs_/);
    expect(share.expires_at.getTime() - share.created_at.getTime()).toBe(24 * 3600_000);
    const chat = await prisma.chatConversation.findUniqueOrThrow({ where: { id: r.idChatConversation } });
    expect(chat).toMatchObject({ kind: 'direct', id_user: laura.idUser, id_agent: idAgent });
    const msg = await prisma.chatMessage.findFirstOrThrow({ where: { id_conversation: chat.id }, orderBy: { id: 'desc' } });
    expect(msg).toMatchObject({ role: 'user', id_user_author: laura.idUser, delivered_at: null });
    expect(msg.body).toContain(`share_id: ${share.token}`);
    expect(await prisma.emailAudit.count({ where: { id_user: laura.idUser, accion: 'COMPARTIR_AGENTE' } })).toBe(1);
    expect((await concesionesDeHilo(deps(), px, laura, CONV)).map((c) => c.id)).toEqual([r.idShare]);
    expect(await concesionesDeHilo(deps(), px, maria, CONV)).toEqual([]);
  });

  it('CHECK de la base: tipo/estado válidos y vigencia máxima de 25 h', async () => {
    const share = await prisma.emailAgentShare.findFirstOrThrow({ where: { id_user: laura.idUser } });
    await expect(prisma.emailAgentAction.create({ data: { id_share: share.id, id_agent: idAgent, tipo: 'ENVIAR_YA', payload: '{}' } })).rejects.toThrow();
    await expect(prisma.emailAgentAction.create({ data: { id_share: share.id, id_agent: idAgent, tipo: 'NOTA', estado: 'AUTO', payload: '{}' } })).rejects.toThrow();
    const ahora = new Date();
    await expect(
      prisma.emailAgentShare.create({ data: { token: `cs_largo_${s}_xxxxxxxx`, id_user: laura.idUser, mailbox: laura.email, conversation_id: CONV, id_agent: idAgent, id_chat_conversation: 1, created_at: ahora, expires_at: new Date(ahora.getTime() + 30 * 24 * 3600_000) } })
    ).rejects.toThrow();
  });

  it('tarjetas por persona, un solo envío y la auditoría de la confirmación', async () => {
    const { accion, chat } = await propuestaDe(laura, { cuerpo: 'Recibido, gracias.', todos: false, para: ['prueba.uno@gsslatam.com'] });
    await propuestaDe(maria, { cuerpo: 'De María', todos: false });
    const vistas = await accionesDeChat(deps(), px, laura, chat);
    expect(vistas.map((v) => v.id)).toContain(accion.id);
    expect((await accionesDeChat(deps(), px, maria, chat)).map((v) => v.id)).not.toContain(accion.id);
    await expect(confirmarAccion(deps(), px, maria, accion.id, {}, null)).rejects.toMatchObject({ status: 404 });

    const antes = enviadosSimulados(laura.email).length;
    const r = await Promise.allSettled([confirmarAccion(deps(), px, laura, accion.id, {}, '10.1.1.2'), confirmarAccion(deps(), px, laura, accion.id, {}, '10.1.1.2')]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(enviadosSimulados(laura.email).length - antes).toBe(1);
    expect(await prisma.emailAgentAction.findUniqueOrThrow({ where: { id: accion.id } })).toMatchObject({ estado: 'CONFIRMADA', decided_by: laura.idUser });
    expect(await prisma.emailAudit.count({ where: { id_user: laura.idUser, accion: { in: ['RESPONDER', 'AGENTE_CONFIRMAR'] } } })).toBe(2);
    // El agente se entera por su chat (mensaje de la persona, pendiente de entrega).
    const ultimo = await prisma.chatMessage.findFirstOrThrow({ where: { id_conversation: chat }, orderBy: { id: 'desc' } });
    expect(ultimo).toMatchObject({ role: 'user', id_user_author: laura.idUser, delivered_at: null });
  });

  it('revocada: la propuesta ya no se confirma; descartar sí, y queda auditado', async () => {
    const { accion, share } = await propuestaDe(laura, { cuerpo: 'Otra', todos: false });
    expect(await revocarConcesion(deps(), px, maria, share.id, null).catch((e) => e.status)).toBe(404);
    await revocarConcesion(deps(), px, laura, share.id, null);
    await expect(confirmarAccion(deps(), px, laura, accion.id, {}, null)).rejects.toMatchObject({ status: 410 });
    await descartarAccion(deps(), px, laura, accion.id, null);
    expect((await prisma.emailAgentAction.findUniqueOrThrow({ where: { id: accion.id } })).estado).toBe('DESCARTADA');
    expect(await prisma.emailAudit.count({ where: { id_user: laura.idUser, accion: { in: ['REVOCAR_AGENTE', 'AGENTE_DESCARTAR'] } } })).toBe(2);
  });
});
